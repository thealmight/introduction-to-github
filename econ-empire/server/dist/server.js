"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const dayjs_1 = __importDefault(require("dayjs"));
const prisma_1 = require("./lib/prisma");
const auth_1 = require("./lib/auth");
const validation_1 = require("./lib/validation");
const sync_1 = require("csv-stringify/sync");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: { origin: '*' }
});
const gameTimers = new Map();
io.on('connection', (socket) => {
    socket.on('presence:join', ({ gameId }) => {
        socket.join(`game:${gameId}`);
    });
    socket.on('presence:leave', ({ gameId }) => {
        socket.leave(`game:${gameId}`);
    });
    socket.on('chat:send', async (payload) => {
        try {
            const authHeader = payload.token ? `Bearer ${payload.token}` : undefined;
            // No direct auth here; recommend REST for auth. For simplicity, ignore.
            const { gameId, content, toCountryCode } = payload;
            const message = validation_1.ChatMessageSchema.parse({ content, toCountryCode });
            const game = await prisma_1.prisma.game.findUnique({ where: { id: gameId } });
            if (!game)
                return;
            // We cannot trust sender via socket without auth; skipping DB persist.
            io.to(`game:${gameId}`).emit('chat:message', {
                senderCountry: undefined,
                toCountry: toCountryCode || null,
                content: message.content,
                timestamp: new Date().toISOString(),
            });
        }
        catch {
            // swallow
        }
    });
});
// Utilities
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function splitSum(total, parts) {
    // Positive integers summing to total, at least 1 each
    const cuts = new Set();
    while (cuts.size < parts - 1)
        cuts.add(randomInt(1, total - 1));
    const arr = [0, ...Array.from(cuts).sort((a, b) => a - b), total];
    const res = [];
    for (let i = 1; i < arr.length; i++)
        res.push(arr[i] - arr[i - 1]);
    return res;
}
async function generateProductionAndDemand(gameId) {
    const countries = await prisma_1.prisma.country.findMany({ orderBy: { id: 'asc' } });
    const products = await prisma_1.prisma.product.findMany({ orderBy: { id: 'asc' } });
    for (const product of products) {
        const numProducers = randomInt(2, 3);
        const producerIndices = new Set();
        while (producerIndices.size < numProducers)
            producerIndices.add(randomInt(0, countries.length - 1));
        const producers = Array.from(producerIndices).map(i => countries[i]);
        const nonProducers = countries.filter(c => !producers.find(p => p.id === c.id));
        const prodShares = splitSum(100, producers.length);
        await prisma_1.prisma.$transaction(producers.map((c, idx) => prisma_1.prisma.production.create({
            data: {
                gameId,
                productId: product.id,
                countryId: c.id,
                quantity: prodShares[idx],
            }
        })));
        const demandShares = splitSum(100, nonProducers.length);
        await prisma_1.prisma.$transaction(nonProducers.map((c, idx) => prisma_1.prisma.demand.create({
            data: {
                gameId,
                productId: product.id,
                countryId: c.id,
                quantity: demandShares[idx],
            }
        })));
    }
}
async function getCurrentRound(gameId) {
    return prisma_1.prisma.round.findFirst({
        where: { gameId, state: 'active' },
        orderBy: { roundNumber: 'asc' },
    });
}
function startRoundTimer(gameId, roundId, endsAt) {
    // Clear any existing
    const existing = gameTimers.get(gameId);
    if (existing)
        clearInterval(existing.intervalId);
    const intervalId = setInterval(async () => {
        const remaining = (0, dayjs_1.default)(endsAt).diff((0, dayjs_1.default)(), 'second');
        io.to(`game:${gameId}`).emit('timer:tick', { roundId, remainingSeconds: Math.max(0, remaining) });
        if (remaining <= 0) {
            clearInterval(intervalId);
            gameTimers.delete(gameId);
            // Close the round automatically
            await prisma_1.prisma.round.update({ where: { id: roundId }, data: { state: 'closed' } });
            io.to(`game:${gameId}`).emit('round:ended', { roundId });
        }
    }, 1000);
    gameTimers.set(gameId, { intervalId, endsAt });
}
// Routes
app.post('/api/login', async (req, res) => {
    try {
        const { username } = validation_1.LoginSchema.parse(req.body);
        const role = username === 'pavan' ? 'operator' : 'player';
        const user = await prisma_1.prisma.appUser.upsert({
            where: { username },
            create: { username, role: role },
            update: { role: role },
        });
        const token = (0, auth_1.signToken)({ userId: user.id, username: user.username, role: user.role });
        return res.json({ token, role: user.role, userId: user.id });
    }
    catch (e) {
        return res.status(400).json({ error: e.message });
    }
});
app.post('/api/games', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    try {
        const input = validation_1.CreateGameSchema.parse(req.body);
        const game = await prisma_1.prisma.game.create({
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
    }
    catch (e) {
        return res.status(400).json({ error: e.message });
    }
});
app.post('/api/games/:gameId/start', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = await prisma_1.prisma.game.update({ where: { id: gameId }, data: { state: 'in_progress' } });
    const round1 = await prisma_1.prisma.round.findFirst({ where: { gameId, roundNumber: 1 } });
    if (!round1)
        return res.status(404).json({ error: 'Round 1 not found' });
    const endsAt = (0, dayjs_1.default)().add(game.roundDurationSeconds, 'second').toDate();
    await prisma_1.prisma.round.update({ where: { id: round1.id }, data: { state: 'active', startsAt: new Date(), endsAt } });
    io.to(`game:${gameId}`).emit('round:started', { roundId: round1.id, roundNumber: 1, endsAt });
    startRoundTimer(gameId, round1.id, endsAt);
    return res.json({ roundId: round1.id, roundNumber: 1, endsAt });
});
app.post('/api/games/:gameId/rounds/:roundId/end', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const roundId = Number(req.params.roundId);
    await prisma_1.prisma.round.update({ where: { id: roundId }, data: { state: 'closed', endsAt: new Date() } });
    const existing = gameTimers.get(gameId);
    if (existing) {
        clearInterval(existing.intervalId);
        gameTimers.delete(gameId);
    }
    io.to(`game:${gameId}`).emit('round:ended', { roundId });
    res.json({ ok: true });
});
app.post('/api/games/:gameId/rounds/next', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = await prisma_1.prisma.game.findUnique({ where: { id: gameId } });
    if (!game)
        return res.status(404).json({ error: 'Game not found' });
    const current = await prisma_1.prisma.round.findFirst({ where: { gameId, state: 'active' } });
    const nextNumber = current ? current.roundNumber + 1 : 1;
    if (nextNumber > game.totalRounds)
        return res.status(400).json({ error: 'No more rounds' });
    const next = await prisma_1.prisma.round.findFirst({ where: { gameId, roundNumber: nextNumber } });
    if (!next)
        return res.status(404).json({ error: 'Next round not found' });
    const endsAt = (0, dayjs_1.default)().add(game.roundDurationSeconds, 'second').toDate();
    await prisma_1.prisma.round.update({ where: { id: next.id }, data: { state: 'active', startsAt: new Date(), endsAt } });
    io.to(`game:${gameId}`).emit('round:started', { roundId: next.id, roundNumber: nextNumber, endsAt });
    startRoundTimer(gameId, next.id, endsAt);
    res.json({ roundId: next.id, roundNumber: nextNumber, endsAt });
});
app.post('/api/games/:gameId/end', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    await prisma_1.prisma.game.update({ where: { id: gameId }, data: { state: 'ended' } });
    res.json({ ok: true });
});
app.get('/api/games/:gameId/chat', (0, auth_1.authMiddleware)(true), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const messages = await prisma_1.prisma.chatMessage.findMany({
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
app.get('/api/games/:gameId/tariff-changes', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const roundNumber = Number(req.query.round);
    if (!roundNumber || roundNumber < 1)
        return res.status(400).json({ error: 'round query required' });
    const rounds = await prisma_1.prisma.round.findMany({ where: { gameId, roundNumber: { in: [roundNumber, roundNumber - 1] } }, orderBy: { roundNumber: 'asc' } });
    const curr = rounds.find(r => r.roundNumber === roundNumber);
    if (!curr)
        return res.status(404).json({ error: 'Round not found' });
    const prev = rounds.find(r => r.roundNumber === roundNumber - 1);
    const [currRates, prevRates, countries, products] = await Promise.all([
        prisma_1.prisma.tariffRate.findMany({ where: { gameId, roundId: curr.id } }),
        prev ? prisma_1.prisma.tariffRate.findMany({ where: { gameId, roundId: prev.id } }) : Promise.resolve([]),
        prisma_1.prisma.country.findMany(),
        prisma_1.prisma.product.findMany(),
    ]);
    const countryById = new Map(countries.map(c => [c.id, c]));
    const productById = new Map(products.map(p => [p.id, p]));
    const prevMap = new Map();
    for (const r of prevRates) {
        prevMap.set(`${r.productId}:${r.fromCountryId}:${r.toCountryId}`, r.ratePercent);
    }
    const changes = [];
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
app.get('/api/games/:gameId/dashboard', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const [game, countries, products, rounds, assignments, productions, demands, tariffs] = await Promise.all([
        prisma_1.prisma.game.findUnique({ where: { id: gameId } }),
        prisma_1.prisma.country.findMany(),
        prisma_1.prisma.product.findMany(),
        prisma_1.prisma.round.findMany({ where: { gameId }, orderBy: { roundNumber: 'asc' } }),
        prisma_1.prisma.playerCountryAssignment.findMany({ where: { gameId }, include: { user: true, country: true } }),
        prisma_1.prisma.production.findMany({ where: { gameId } }),
        prisma_1.prisma.demand.findMany({ where: { gameId } }),
        prisma_1.prisma.tariffRate.findMany({ where: { gameId } }),
    ]);
    res.json({ game, countries, products, rounds, assignments, productions, demands, tariffs });
});
// CSV Exports
app.get('/api/games/:gameId/export/production.csv', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const rows = await prisma_1.prisma.production.findMany({ where: { gameId }, include: { product: true, country: true } });
    const records = rows.map(r => ({ game_id: gameId, product: r.product.name, country: r.country.name, quantity: r.quantity }));
    const csv = (0, sync_1.stringify)(records, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
});
app.get('/api/games/:gameId/export/demand.csv', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const rows = await prisma_1.prisma.demand.findMany({ where: { gameId }, include: { product: true, country: true } });
    const records = rows.map(r => ({ game_id: gameId, product: r.product.name, country: r.country.name, quantity: r.quantity }));
    const csv = (0, sync_1.stringify)(records, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
});
app.get('/api/games/:gameId/export/tariffs.csv', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const rows = await prisma_1.prisma.tariffRate.findMany({ where: { gameId }, include: { round: true, product: true, fromCountry: true, toCountry: true } });
    const records = rows.map(r => ({
        game_id: gameId,
        round_number: r.round.roundNumber,
        product: r.product.name,
        from_country: r.fromCountry.name,
        to_country: r.toCountry.name,
        rate_percent: r.ratePercent,
    }));
    const csv = (0, sync_1.stringify)(records, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
});
app.get('/api/games/:gameId/export/chat.csv', (0, auth_1.authMiddleware)(true), (0, auth_1.requireRole)('operator'), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const rows = await prisma_1.prisma.chatMessage.findMany({ where: { gameId }, include: { sender: true, toCountry: true } });
    const records = rows.map(m => ({
        game_id: gameId,
        timestamp: m.createdAt.toISOString(),
        sender_username: m.sender.username,
        to_country: m.toCountry?.name ?? '',
        content: m.content,
    }));
    const csv = (0, sync_1.stringify)(records, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
});
app.get('/api/games/:gameId/state', (0, auth_1.authMiddleware)(false), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = await prisma_1.prisma.game.findUnique({ where: { id: gameId } });
    if (!game)
        return res.status(404).json({ error: 'Game not found' });
    const round = await getCurrentRound(gameId);
    res.json({ gameState: game.state, currentRound: round?.roundNumber ?? null, endsAt: round?.endsAt ?? null });
});
app.post('/api/games/:gameId/assign', (0, auth_1.authMiddleware)(true), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const user = req.user;
    const countries = await prisma_1.prisma.country.findMany({ orderBy: { id: 'asc' } });
    const assigned = await prisma_1.prisma.playerCountryAssignment.findMany({ where: { gameId } });
    const assignedCountryIds = new Set(assigned.map(a => a.countryId));
    const available = countries.find(c => !assignedCountryIds.has(c.id));
    if (!available)
        return res.status(400).json({ error: 'No available countries' });
    const assignment = await prisma_1.prisma.playerCountryAssignment.upsert({
        where: { gameId_userId: { gameId, userId: user.userId } },
        create: { gameId, userId: user.userId, countryId: available.id },
        update: {},
    });
    res.json({ countryCode: countries.find(c => c.id === assignment.countryId)?.code });
});
app.get('/api/games/:gameId/me', (0, auth_1.authMiddleware)(true), async (req, res) => {
    const gameId = Number(req.params.gameId);
    const user = req.user;
    const assignment = await prisma_1.prisma.playerCountryAssignment.findUnique({ where: { gameId_userId: { gameId, userId: user.userId } }, include: { country: true } });
    res.json({ user: { id: user.userId, username: user.username, role: user.role }, assignedCountry: assignment?.country?.code ?? null });
});
app.post('/api/games/:gameId/rounds/:roundId/tariffs', (0, auth_1.authMiddleware)(true), async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        const roundId = Number(req.params.roundId);
        const items = validation_1.TariffSubmissionSchema.parse(req.body);
        const round = await prisma_1.prisma.round.findUnique({ where: { id: roundId } });
        if (!round || round.gameId !== gameId)
            return res.status(404).json({ error: 'Round not found' });
        if (round.state !== 'active')
            return res.status(400).json({ error: 'Round not active' });
        const me = await prisma_1.prisma.playerCountryAssignment.findUnique({ where: { gameId_userId: { gameId, userId: req.user.userId } }, include: { country: true } });
        if (!me)
            return res.status(400).json({ error: 'Not assigned to a country' });
        // Fetch product and country maps
        const [products, countries, productions] = await Promise.all([
            prisma_1.prisma.product.findMany(),
            prisma_1.prisma.country.findMany(),
            prisma_1.prisma.production.findMany({ where: { gameId, countryId: me.countryId } }),
        ]);
        const codeToProduct = new Map(products.map(p => [p.code, p]));
        const codeToCountry = new Map(countries.map(c => [c.code, c]));
        // Ensure producer rights
        const myProducedProductIds = new Set(productions.map(p => p.productId));
        const ops = [];
        for (const it of items) {
            const product = codeToProduct.get(it.productCode);
            const toCountry = codeToCountry.get(it.toCountryCode);
            if (!product || !toCountry)
                return res.status(400).json({ error: 'Invalid product or country code' });
            if (toCountry.id === me.countryId)
                return res.status(400).json({ error: 'Cannot set self tariff' });
            if (!myProducedProductIds.has(product.id))
                return res.status(403).json({ error: `Not a producer of ${product.code}` });
            ops.push(prisma_1.prisma.tariffRate.upsert({
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
        await prisma_1.prisma.$transaction(ops);
        io.to(`game:${gameId}`).emit('tariffs:updated', { roundId, updates: items });
        res.json({ ok: true });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.post('/api/games/:gameId/chat', (0, auth_1.authMiddleware)(true), async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        const { content, toCountryCode } = validation_1.ChatMessageSchema.parse(req.body);
        const toCountry = toCountryCode ? await prisma_1.prisma.country.findUnique({ where: { code: toCountryCode } }) : null;
        const msg = await prisma_1.prisma.chatMessage.create({
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
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Econ Empire server listening on :${PORT}`);
});
