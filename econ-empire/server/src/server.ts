import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import dayjs from 'dayjs';
import { prisma } from './lib/prisma';
import { authMiddleware, requireRole, signToken } from './lib/auth';
import { ChatMessageSchema, CreateGameSchema, LoginSchema, TariffSubmissionSchema } from './lib/validation';
import { COUNTRY_CODES, PRODUCT_CODES } from './types';
import { stringify } from 'csv-stringify/sync';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*'}
});

// In-memory timers and presence
type TimerInfo = { intervalId: NodeJS.Timeout; endsAt: Date };
const gameTimers = new Map<number, TimerInfo>();

io.on('connection', (socket) => {
  socket.on('presence:join', ({ gameId }: { gameId: number }) => {
    socket.join(`game:${gameId}`);
  });
  socket.on('presence:leave', ({ gameId }: { gameId: number }) => {
    socket.leave(`game:${gameId}`);
  });

  socket.on('chat:send', async (payload: { gameId: number; content: string; toCountryCode?: string; token?: string }) => {
    try {
      const authHeader = payload.token ? `Bearer ${payload.token}` : undefined;
      // No direct auth here; recommend REST for auth. For simplicity, ignore.
      const { gameId, content, toCountryCode } = payload;
      const message = ChatMessageSchema.parse({ content, toCountryCode });
      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) return;
      // We cannot trust sender via socket without auth; skipping DB persist.
      io.to(`game:${gameId}`).emit('chat:message', {
        senderCountry: undefined,
        toCountry: toCountryCode || null,
        content: message.content,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // swallow
    }
  });
});

// Utilities
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function splitSum(total: number, parts: number): number[] {
  // Positive integers summing to total, at least 1 each
  const cuts = new Set<number>();
  while (cuts.size < parts - 1) cuts.add(randomInt(1, total - 1));
  const arr = [0, ...Array.from(cuts).sort((a,b)=>a-b), total];
  const res: number[] = [];
  for (let i = 1; i < arr.length; i++) res.push(arr[i] - arr[i-1]);
  return res;
}

async function generateProductionAndDemand(gameId: number) {
  const countries = await prisma.country.findMany({ orderBy: { id: 'asc' } });
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });

  for (const product of products) {
    const numProducers = randomInt(2,3);
    const producerIndices = new Set<number>();
    while (producerIndices.size < numProducers) producerIndices.add(randomInt(0, countries.length - 1));
    const producers = Array.from(producerIndices).map(i => countries[i]);
    const nonProducers = countries.filter(c => !producers.find(p => p.id === c.id));

    const prodShares = splitSum(100, producers.length);
    await prisma.$transaction(producers.map((c, idx) => prisma.production.create({
      data: {
        gameId,
        productId: product.id,
        countryId: c.id,
        quantity: prodShares[idx],
      }
    })));

    const demandShares = splitSum(100, nonProducers.length);
    await prisma.$transaction(nonProducers.map((c, idx) => prisma.demand.create({
      data: {
        gameId,
        productId: product.id,
        countryId: c.id,
        quantity: demandShares[idx],
      }
    })));
  }
}

async function getCurrentRound(gameId: number) {
  return prisma.round.findFirst({
    where: { gameId, state: 'active' },
    orderBy: { roundNumber: 'asc' },
  });
}

function startRoundTimer(gameId: number, roundId: number, endsAt: Date) {
  // Clear any existing
  const existing = gameTimers.get(gameId);
  if (existing) clearInterval(existing.intervalId);

  const intervalId = setInterval(async () => {
    const remaining = dayjs(endsAt).diff(dayjs(), 'second');
    io.to(`game:${gameId}`).emit('timer:tick', { roundId, remainingSeconds: Math.max(0, remaining) });
    if (remaining <= 0) {
      clearInterval(intervalId);
      gameTimers.delete(gameId);
      // Close the round automatically
      await prisma.round.update({ where: { id: roundId }, data: { state: 'closed' } });
      io.to(`game:${gameId}`).emit('round:ended', { roundId });
    }
  }, 1000);

  gameTimers.set(gameId, { intervalId, endsAt });
}

// Routes
app.post('/api/login', async (req, res) => {
  try {
    const { username } = LoginSchema.parse(req.body);
    const role = username === 'pavan' ? 'operator' : 'player';
    const user = await prisma.appUser.upsert({
      where: { username },
      create: { username, role: role as any },
      update: { role: role as any },
    });
    const token = signToken({ userId: user.id, username: user.username, role: user.role as any });
    return res.json({ token, role: user.role, userId: user.id });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

app.post('/api/games', authMiddleware(true), requireRole('operator'), async (req, res) => {
  try {
    const input = CreateGameSchema.parse(req.body);
    const game = await prisma.game.create({
      data: {
        totalRounds: input.totalRounds,
        roundDurationSeconds: input.roundDurationSeconds,
        state: 'lobby',
        rounds: {
          create: Array.from({ length: input.totalRounds }, (_, i) => ({ roundNumber: i + 1, state: 'pending' }))
        }
      },
      include: { rounds: true }
    });

    await generateProductionAndDemand(game.id);

    return res.json({ gameId: game.id });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

app.post('/api/games/:gameId/start', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const game = await prisma.game.update({ where: { id: gameId }, data: { state: 'in_progress' } });
  const round1 = await prisma.round.findFirst({ where: { gameId, roundNumber: 1 } });
  if (!round1) return res.status(404).json({ error: 'Round 1 not found' });
  const endsAt = dayjs().add(game.roundDurationSeconds, 'second').toDate();
  await prisma.round.update({ where: { id: round1.id }, data: { state: 'active', startsAt: new Date(), endsAt } });
  io.to(`game:${gameId}`).emit('round:started', { roundId: round1.id, roundNumber: 1, endsAt });
  startRoundTimer(gameId, round1.id, endsAt);
  return res.json({ roundId: round1.id, roundNumber: 1, endsAt });
});

app.post('/api/games/:gameId/rounds/:roundId/end', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const roundId = Number(req.params.roundId);
  await prisma.round.update({ where: { id: roundId }, data: { state: 'closed', endsAt: new Date() } });
  const existing = gameTimers.get(gameId);
  if (existing) { clearInterval(existing.intervalId); gameTimers.delete(gameId); }
  io.to(`game:${gameId}`).emit('round:ended', { roundId });
  res.json({ ok: true });
});

app.post('/api/games/:gameId/rounds/next', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const current = await prisma.round.findFirst({ where: { gameId, state: 'active' } });
  const nextNumber = current ? current.roundNumber + 1 : 1;
  if (nextNumber > game.totalRounds) return res.status(400).json({ error: 'No more rounds' });
  const next = await prisma.round.findFirst({ where: { gameId, roundNumber: nextNumber } });
  if (!next) return res.status(404).json({ error: 'Next round not found' });
  const endsAt = dayjs().add(game.roundDurationSeconds, 'second').toDate();
  await prisma.round.update({ where: { id: next.id }, data: { state: 'active', startsAt: new Date(), endsAt } });
  io.to(`game:${gameId}`).emit('round:started', { roundId: next.id, roundNumber: nextNumber, endsAt });
  startRoundTimer(gameId, next.id, endsAt);
  res.json({ roundId: next.id, roundNumber: nextNumber, endsAt });
});

app.post('/api/games/:gameId/end', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  await prisma.game.update({ where: { id: gameId }, data: { state: 'ended' } });
  res.json({ ok: true });
});

app.get('/api/games/:gameId/chat', authMiddleware(true), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const since = req.query.since ? new Date(String(req.query.since)) : undefined;
  const messages = await prisma.chatMessage.findMany({
    where: { gameId, ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { sender: true, toCountry: true }
  });
  res.json(messages.map(m => ({
    id: m.id,
    timestamp: m.createdAt,
    sender: m.sender.username,
    toCountry: m.toCountry?.code ?? null,
    content: m.content,
  })));
});

app.get('/api/games/:gameId/tariff-changes', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const roundNumber = Number(req.query.round);
  if (!roundNumber || roundNumber < 1) return res.status(400).json({ error: 'round query required' });
  const rounds = await prisma.round.findMany({ where: { gameId, roundNumber: { in: [roundNumber, roundNumber - 1] } }, orderBy: { roundNumber: 'asc' } });
  const curr = rounds.find(r => r.roundNumber === roundNumber);
  if (!curr) return res.status(404).json({ error: 'Round not found' });
  const prev = rounds.find(r => r.roundNumber === roundNumber - 1);

  const [currRates, prevRates, countries, products] = await Promise.all([
    prisma.tariffRate.findMany({ where: { gameId, roundId: curr.id } }),
    prev ? prisma.tariffRate.findMany({ where: { gameId, roundId: prev.id } }) : Promise.resolve([]),
    prisma.country.findMany(),
    prisma.product.findMany(),
  ]);
  const countryById = new Map(countries.map(c => [c.id, c] as const));
  const productById = new Map(products.map(p => [p.id, p] as const));

  const prevMap = new Map<string, number>();
  for (const r of prevRates) {
    prevMap.set(`${r.productId}:${r.fromCountryId}:${r.toCountryId}`, r.ratePercent);
  }
  const changes: any[] = [];
  for (const r of currRates) {
    const key = `${r.productId}:${r.fromCountryId}:${r.toCountryId}`;
    const before = prevMap.get(key) ?? 0;
    if (before !== r.ratePercent) {
      changes.push({
        product: productById.get(r.productId)?.code,
        fromCountry: countryById.get(r.fromCountryId)?.code,
        toCountry: countryById.get(r.toCountryId)?.code,
        previous: before,
        current: r.ratePercent,
      });
    }
  }
  res.json({ round: roundNumber, changes });
});

app.get('/api/games/:gameId/dashboard', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const [game, countries, products, rounds, assignments, productions, demands, tariffs] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId } }),
    prisma.country.findMany(),
    prisma.product.findMany(),
    prisma.round.findMany({ where: { gameId }, orderBy: { roundNumber: 'asc' } }),
    prisma.playerCountryAssignment.findMany({ where: { gameId }, include: { user: true, country: true } }),
    prisma.production.findMany({ where: { gameId } }),
    prisma.demand.findMany({ where: { gameId } }),
    prisma.tariffRate.findMany({ where: { gameId } }),
  ]);
  res.json({ game, countries, products, rounds, assignments, productions, demands, tariffs });
});

// CSV Exports
app.get('/api/games/:gameId/export/production.csv', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const rows = await prisma.production.findMany({ where: { gameId }, include: { product: true, country: true } });
  const records = rows.map(r => ({ game_id: gameId, product: r.product.name, country: r.country.name, quantity: r.quantity }));
  const csv = stringify(records, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/games/:gameId/export/demand.csv', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const rows = await prisma.demand.findMany({ where: { gameId }, include: { product: true, country: true } });
  const records = rows.map(r => ({ game_id: gameId, product: r.product.name, country: r.country.name, quantity: r.quantity }));
  const csv = stringify(records, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/games/:gameId/export/tariffs.csv', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const rows = await prisma.tariffRate.findMany({ where: { gameId }, include: { round: true, product: true, fromCountry: true, toCountry: true } });
  const records = rows.map(r => ({
    game_id: gameId,
    round_number: r.round.roundNumber,
    product: r.product.name,
    from_country: r.fromCountry.name,
    to_country: r.toCountry.name,
    rate_percent: r.ratePercent,
  }));
  const csv = stringify(records, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/games/:gameId/export/chat.csv', authMiddleware(true), requireRole('operator'), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const rows = await prisma.chatMessage.findMany({ where: { gameId }, include: { sender: true, toCountry: true } });
  const records = rows.map(m => ({
    game_id: gameId,
    timestamp: m.createdAt.toISOString(),
    sender_username: m.sender.username,
    to_country: m.toCountry?.name ?? '',
    content: m.content,
  }));
  const csv = stringify(records, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/games/:gameId/state', authMiddleware(false), async (req, res) => {
  const gameId = Number(req.params.gameId);
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const round = await getCurrentRound(gameId);
  res.json({ gameState: game.state, currentRound: round?.roundNumber ?? null, endsAt: round?.endsAt ?? null });
});

app.post('/api/games/:gameId/assign', authMiddleware(true), async (req: any, res) => {
  const gameId = Number(req.params.gameId);
  const user = req.user!;
  const countries = await prisma.country.findMany({ orderBy: { id: 'asc' } });
  const assigned = await prisma.playerCountryAssignment.findMany({ where: { gameId } });
  const assignedCountryIds = new Set(assigned.map(a => a.countryId));
  const available = countries.find(c => !assignedCountryIds.has(c.id));
  if (!available) return res.status(400).json({ error: 'No available countries' });
  const assignment = await prisma.playerCountryAssignment.upsert({
    where: { gameId_userId: { gameId, userId: user.userId } },
    create: { gameId, userId: user.userId, countryId: available.id },
    update: {},
  });
  res.json({ countryCode: countries.find(c => c.id === assignment.countryId)?.code });
});

app.get('/api/games/:gameId/me', authMiddleware(true), async (req: any, res) => {
  const gameId = Number(req.params.gameId);
  const user = req.user!;
  const assignment = await prisma.playerCountryAssignment.findUnique({ where: { gameId_userId: { gameId, userId: user.userId } }, include: { country: true } });
  res.json({ user: { id: user.userId, username: user.username, role: user.role }, assignedCountry: assignment?.country?.code ?? null });
});

app.post('/api/games/:gameId/rounds/:roundId/tariffs', authMiddleware(true), async (req: any, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const roundId = Number(req.params.roundId);
    const items = TariffSubmissionSchema.parse(req.body);

    const round = await prisma.round.findUnique({ where: { id: roundId } });
    if (!round || round.gameId !== gameId) return res.status(404).json({ error: 'Round not found' });
    if (round.state !== 'active') return res.status(400).json({ error: 'Round not active' });

    const me = await prisma.playerCountryAssignment.findUnique({ where: { gameId_userId: { gameId, userId: req.user.userId } } , include: { country: true }});
    if (!me) return res.status(400).json({ error: 'Not assigned to a country' });

    // Fetch product and country maps
    const [products, countries, productions] = await Promise.all([
      prisma.product.findMany(),
      prisma.country.findMany(),
      prisma.production.findMany({ where: { gameId, countryId: me.countryId } }),
    ]);
    const codeToProduct = new Map(products.map(p => [p.code, p] as const));
    const codeToCountry = new Map(countries.map(c => [c.code, c] as const));

    // Ensure producer rights
    const myProducedProductIds = new Set(productions.map(p => p.productId));

    const ops = [] as any[];
    for (const it of items) {
      const product = codeToProduct.get(it.productCode);
      const toCountry = codeToCountry.get(it.toCountryCode);
      if (!product || !toCountry) return res.status(400).json({ error: 'Invalid product or country code' });
      if (toCountry.id === me.countryId) return res.status(400).json({ error: 'Cannot set self tariff' });
      if (!myProducedProductIds.has(product.id)) return res.status(403).json({ error: `Not a producer of ${product.code}` });

      ops.push(prisma.tariffRate.upsert({
        where: {
          gameId_roundId_productId_fromCountryId_toCountryId: {
            gameId,
            roundId,
            productId: product.id,
            fromCountryId: me.countryId,
            toCountryId: toCountry.id,
          }
        },
        update: { ratePercent: it.ratePercent },
        create: {
          gameId,
          roundId,
          productId: product.id,
          fromCountryId: me.countryId,
          toCountryId: toCountry.id,
          ratePercent: it.ratePercent,
        }
      }));
    }

    await prisma.$transaction(ops);

    io.to(`game:${gameId}`).emit('tariffs:updated', { roundId, updates: items });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/games/:gameId/chat', authMiddleware(true), async (req: any, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const { content, toCountryCode } = ChatMessageSchema.parse(req.body);
    const toCountry = toCountryCode ? await prisma.country.findUnique({ where: { code: toCountryCode } }) : null;
    const msg = await prisma.chatMessage.create({
      data: {
        gameId,
        senderUserId: req.user.userId,
        toCountryId: toCountry?.id,
        content,
      },
    });
    io.to(`game:${gameId}`).emit('chat:message', {
      id: msg.id,
      senderCountry: null,
      toCountry: toCountryCode ?? null,
      content,
      timestamp: msg.createdAt,
    });
    res.status(201).json({ id: msg.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Econ Empire server listening on :${PORT}`);
});