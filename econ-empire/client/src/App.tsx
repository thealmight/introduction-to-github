import { useEffect, useMemo, useState } from 'react'
import './App.css'
import dayjs from 'dayjs'
import { login, setAuthToken, getGameState, assignCountry, getMyData, submitTariffs } from './lib/api'
import { useAppStore } from './store'
import { getSocket, joinGameRoom } from './lib/socket'
import OperatorDashboard from './components/OperatorDashboard'
import Chat from './components/Chat'

function Login() {
  const [username, setUsername] = useState('')
  const setAuth = useAppStore(s => s.setAuth)
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
      <button onClick={async ()=>{
        const res = await login(username)
        setAuth(res.token, res.role, res.userId)
        setAuthToken(res.token)
      }}>Login</button>
    </div>
  )
}

function PlayerPanel() {
  const gameId = useAppStore(s => s.gameId)
  const setGame = useAppStore(s => s.setGame)
  const [myCountry, setMyCountry] = useState<string| null>(null)
  const [roundId, setRoundId] = useState<number | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  const [myData, setMyData] = useState<any>(null)
  const [tariffInput, setTariffInput] = useState<{productCode: string; toCountryCode: string; ratePercent: number}>({ productCode: 'STEEL', toCountryCode: 'CHN', ratePercent: 0 })
  const myCountryCode = useMemo(()=>{
    if (!myData) return null;
    const c = myData.countries.find((c:any)=> c.id === myData.myCountryId);
    return c?.code ?? null;
  }, [myData])

  useEffect(()=>{
    if (!gameId) return
    joinGameRoom(gameId)
    const s = getSocket()
    s.on('round:started', (e: any) => {
      setRoundId(e.roundId)
      setEndsAt(e.endsAt)
    })
    s.on('timer:tick', (e: any) => {
      setRemaining(e.remainingSeconds)
    })
    s.on('round:ended', ()=>{
      setRemaining(0)
    })
    return ()=>{
      s.off('round:started')
      s.off('timer:tick')
      s.off('round:ended')
    }
  }, [gameId])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', gap:8 }}>
        <input type="number" placeholder="Game ID" value={gameId ?? ''} onChange={e=> setGame(e.target.value? Number(e.target.value): null)} />
        <button disabled={!gameId} onClick={async ()=>{
          if (!gameId) return
          const a = await assignCountry(gameId)
          setMyCountry(a.countryCode)
        }}>Assign my country</button>
        <button disabled={!gameId} onClick={async ()=>{
          if (!gameId) return
          const state = await getGameState(gameId)
          if (state.endsAt) setEndsAt(state.endsAt)
        }}>Sync state</button>
        <button disabled={!gameId} onClick={async ()=>{
          if (!gameId) return
          const data = await getMyData(gameId)
          setMyData(data)
          setRoundId(data.currentRound?.id ?? null)
        }}>Load my data</button>
      </div>
      <div>My country: {myCountry ?? '-'}</div>
      <div>Round: {roundId ?? '-'} | Remaining: {remaining}s {endsAt ? `(ends ${dayjs(endsAt).format('HH:mm:ss')})` : ''}</div>
      {myData && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div>
            <h3>Production</h3>
            <ul>
              {myData.productions.map((p:any)=> <li key={p.id}>{myData.products.find((x:any)=>x.id===p.productId)?.name}: {p.quantity}</li>)}
            </ul>
            <h3>Demand</h3>
            <ul>
              {myData.demands.map((d:any)=> <li key={d.id}>{myData.products.find((x:any)=>x.id===d.productId)?.name}: {d.quantity}</li>)}
            </ul>
          </div>
          <div>
            <h3>Submit Tariff</h3>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <select value={tariffInput.productCode} onChange={e=> setTariffInput(v=> ({...v, productCode: e.target.value}))}>
                {myData.products.filter((p:any)=> myData.productions.some((pr:any)=> pr.productId === p.id)).map((p:any)=> <option key={p.id} value={p.code}>{p.name}</option>)}
              </select>
              <select value={tariffInput.toCountryCode} onChange={e=> setTariffInput(v=> ({...v, toCountryCode: e.target.value}))}>
                {myData.countries.filter((c:any)=> c.code !== myCountryCode).map((c:any)=> <option key={c.id} value={c.code}>{c.name}</option>)}
              </select>
              <input type="number" min={0} max={100} value={tariffInput.ratePercent} onChange={e=> setTariffInput(v=> ({...v, ratePercent: Number(e.target.value)}))} />
              <button disabled={!roundId || !myCountryCode || tariffInput.toCountryCode === myCountryCode} onClick={async ()=>{
                if (!gameId || !roundId) return
                await submitTariffs(gameId, roundId, [tariffInput])
                alert('Submitted')
              }}>Submit</button>
            </div>
          </div>
          <div>
            <h3>Chat</h3>
            <Chat gameId={gameId!} countries={myData.countries} />
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const role = useAppStore(s => s.role)
  const gameId = useAppStore(s => s.gameId)
  const setGame = useAppStore(s => s.setGame)
  return (
    <div style={{ padding: 16, display:'flex', flexDirection:'column', gap:16 }}>
      <h2>Econ Empire</h2>
      {!role ? <Login /> : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:24 }}>
          <div>
            {role === 'operator' ? (
              <OperatorDashboard gameId={gameId} onGameId={setGame} />
            ) : (
              <div>Logged in as player</div>
            )}
          </div>
          <div>
            <PlayerPanel />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
