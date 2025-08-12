import { useEffect, useMemo, useState } from 'react';
import { createGame, downloadCsv, getDashboard, getTariffChanges, startGame } from '../lib/api';
import Chat from './Chat';

interface OperatorDashboardProps {
  gameId: number | null;
  onGameId: (id: number | null) => void;
}

export default function OperatorDashboard({ gameId, onGameId }: OperatorDashboardProps) {
  const [totalRounds, setTotalRounds] = useState(5);
  const [roundSeconds, setRoundSeconds] = useState(900);
  const [data, setData] = useState<any | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState<string>('STEEL');
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [diffs, setDiffs] = useState<any[]>([]);

  useEffect(() => {
    if (!gameId) return;
    (async () => {
      const d = await getDashboard(gameId);
      setData(d);
      const maxRound = d.rounds.length ? d.rounds[d.rounds.length - 1].roundNumber : 1;
      if (!selectedRound || selectedRound > maxRound) setSelectedRound(1);
    })();
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    (async () => {
      try {
        const res = await getTariffChanges(gameId, selectedRound);
        setDiffs(res.changes);
      } catch {
        setDiffs([]);
      }
    })();
  }, [gameId, selectedRound]);

  const countries = data?.countries ?? [];
  const products = data?.products ?? [];
  const tariffs = data?.tariffs ?? [];

  const matrix = useMemo(() => {
    if (!data) return [] as any[];
    const product = products.find((p: any) => p.code === selectedProductCode);
    if (!product) return [];
    const round = data.rounds.find((r: any) => r.roundNumber === selectedRound);
    if (!round) return [];
    const byKey = new Map<string, number>();
    for (const t of tariffs) {
      if (t.roundId === round.id && t.productId === product.id) {
        byKey.set(`${t.fromCountryId}:${t.toCountryId}`, t.ratePercent);
      }
    }
    return countries.map((from: any) => countries.map((to: any) => from.id === to.id ? 0 : (byKey.get(`${from.id}:${to.id}`) ?? 0)));
  }, [data, selectedProductCode, selectedRound]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="number" placeholder="Game ID" value={gameId ?? ''} onChange={e => onGameId(e.target.value ? Number(e.target.value) : null)} />
        <button onClick={async ()=>{
          const res = await createGame({ totalRounds, roundDurationSeconds: roundSeconds });
          onGameId(res.gameId);
        }}>Create</button>
        <button disabled={!gameId} onClick={async ()=>{ if (gameId) await startGame(gameId); }}>Start</button>
        <span>Rounds:</span>
        <input type="number" value={totalRounds} onChange={e=>setTotalRounds(Number(e.target.value))} style={{ width: 80 }} />
        <span>Seconds:</span>
        <input type="number" value={roundSeconds} onChange={e=>setRoundSeconds(Number(e.target.value))} style={{ width: 80 }} />
        <button disabled={!gameId} onClick={()=> gameId && downloadCsv(gameId, 'production')}>Production CSV</button>
        <button disabled={!gameId} onClick={()=> gameId && downloadCsv(gameId, 'demand')}>Demand CSV</button>
        <button disabled={!gameId} onClick={()=> gameId && downloadCsv(gameId, 'tariffs')}>Tariffs CSV</button>
        <button disabled={!gameId} onClick={()=> gameId && downloadCsv(gameId, 'chat')}>Chat CSV</button>
      </div>

      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>Product</span>
            <select value={selectedProductCode} onChange={e=>setSelectedProductCode(e.target.value)}>
              {products.map((p:any)=>(<option key={p.id} value={p.code}>{p.name}</option>))}
            </select>
            <span>Round</span>
            <select value={selectedRound} onChange={e=>setSelectedRound(Number(e.target.value))}>
              {data.rounds.map((r:any)=>(<option key={r.id} value={r.roundNumber}>{r.roundNumber}</option>))}
            </select>
          </div>

          <div>
            <h3>Tariff matrix (rate %)</h3>
            <table style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ border:'1px solid #ddd', padding:4 }}></th>
                  {countries.map((c:any)=>(<th key={c.id} style={{ border:'1px solid #ddd', padding:4 }}>{c.code}</th>))}
                </tr>
              </thead>
              <tbody>
                {countries.map((from:any, i:number)=>(
                  <tr key={from.id}>
                    <td style={{ border:'1px solid #ddd', padding:4, fontWeight:'bold' }}>{from.code}</td>
                    {countries.map((to:any, j:number)=>(
                      <td key={to.id} style={{ border:'1px solid #ddd', padding:4, textAlign:'center' }}>{matrix[i]?.[j] ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3>Round {selectedRound} changes vs prev</h3>
            {diffs.length === 0 ? <div>No changes</div> : (
              <ul>
                {diffs.map((d:any, idx:number)=>(
                  <li key={idx}>{d.product} {d.fromCountry} → {d.toCountry}: {d.previous}% → {d.current}%</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>Chat</h3>
            <Chat gameId={gameId!} countries={countries} />
          </div>
        </>
      )}
    </div>
  );
}