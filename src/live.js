let profile;
let socket;
let retry;
let generation=0;
let state={questions:[],mine:[],answers:[],unread:0};
export const currentState=() => state;
export function requestId() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function api(url,body) {
  const headers={'x-user-id':profile?.id || ''};
  if (body && !(body instanceof FormData)) headers['Content-Type']='application/json';
  const response=await fetch(url,{method:body ? 'POST':'GET',headers,body:body instanceof FormData ? body : body ? JSON.stringify(body):undefined});
  const result=await response.json();
  if (!response.ok) throw new Error(result.error || 'לא הצלחנו להתחבר לשרת.');
  return result;
}
function connection(message) { document.querySelector('#live-status').textContent=message; }
export function connectProfile(next) {
  profile=next; generation++;
  const version=generation;
  clearTimeout(retry); if (socket) { socket.onclose=null; socket.close(); }
  async function connect() {
    if (version!==generation) return;
    connection('מתחברים לקהילה…');
    try {
      await api('/api/profile',profile);
      if (version!==generation) return;
      const active=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/live?id=${encodeURIComponent(profile.id)}`);
      socket=active;
      active.onopen=()=>{if(version===generation)connection('מחוברים לקהילה');};
      active.onmessage=event=> {
        if(version!==generation)return;
        const message=JSON.parse(event.data);
        if (message.type==='snapshot') { state=message; window.dispatchEvent(new CustomEvent('community-state',{detail:state})); }
        if (['question','answer'].includes(message.type)) {
          const toast=document.querySelector('#live-toast');
          toast.textContent=message.type==='question'?'שאלה חדשה בקהילה — רוצה לעזור?':'יש תשובה חדשה לשאלה שלך';
          toast.hidden=false;
          toast.onclick=()=>{ location.hash=message.type==='question'?'help':'inbox'; toast.hidden=true; };
          clearTimeout(toast.timer); toast.timer=setTimeout(()=>{toast.hidden=true;},7000);
        }
      };
      active.onclose=()=>{if(version!==generation)return;connection('החיבור נותק. מתחברים מחדש…'); retry=setTimeout(connect,2000);};
      active.onerror=()=>active.close();
    } catch { connection('אין חיבור לשרת. מנסים שוב…'); retry=setTimeout(connect,3000); }
  }
  void connect();
}
window.addEventListener('online',()=>{if(profile)connectProfile(profile);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && profile && socket?.readyState!==WebSocket.OPEN)connectProfile(profile);});
