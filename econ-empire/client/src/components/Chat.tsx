import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { getChat, sendChat } from '../lib/api';
import { getSocket } from '../lib/socket';

interface ChatProps {
  gameId: number;
  countries?: Array<{ id: number; code: string; name: string }>;
}

export default function Chat({ gameId, countries }: ChatProps) {
  const [messages, setMessages] = useState<Array<{ id: number; timestamp: string; sender?: string; toCountry?: string|null; content: string }>>([]);
  const [text, setText] = useState('');
  const [to, setTo] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const initial = await getChat(gameId);
      setMessages(initial);
    })();
    const s = getSocket();
    const handler = (m: any) => {
      setMessages((prev) => [...prev, { id: m.id ?? Date.now(), timestamp: (m.timestamp ?? new Date()).toString(), sender: m.sender ?? undefined, toCountry: m.toCountry ?? null, content: m.content }]);
    };
    s.on('chat:message', handler);
    return () => { s.off('chat:message', handler); };
  }, [gameId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  return (
    <div style={{ border: '1px solid #ddd', padding: 8, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={listRef} style={{ height: 200, overflowY: 'auto', background: '#fafafa', padding: 8 }}>
        {messages.map(m => (
          <div key={m.id} style={{ fontSize: 12, marginBottom: 6 }}>
            <div style={{ color: '#666' }}>{dayjs(m.timestamp).format('HH:mm:ss')} {m.sender ? `(${m.sender})` : ''} {m.toCountry ? `→ ${m.toCountry}` : ''}</div>
            <div>{m.content}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ flex: 1 }} placeholder="Type a message" value={text} onChange={e=>setText(e.target.value)} />
        <select value={to} onChange={e=>setTo(e.target.value)}>
          <option value="">Group</option>
          {countries?.map(c => (
            <option key={c.id} value={c.code}>{c.name}</option>
          ))}
        </select>
        <button onClick={async ()=>{
          if (!text.trim()) return;
          await sendChat(gameId, text, to || undefined);
          setText('');
        }}>Send</button>
      </div>
    </div>
  );
}