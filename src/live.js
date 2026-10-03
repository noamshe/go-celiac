let profile;
let socket;
let retry;
let generation=0;
let registration;
let backendConfig={uploads:'local'};
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
  if(response.status===413)throw new Error('התמונות גדולות מדי לשרת. נסה תמונות קטנות יותר.');
  const raw=await response.text();
  let result;
  try { result=JSON.parse(raw); }
  catch {
    throw new Error('שרת הקהילה לא זמין בכתובת הזו. יש להגדיר את שירות השאלות והאחסון בפריסה.');
  }
  if (!response.ok) throw new Error(result.error || 'לא הצלחנו להתחבר לשרת.');
  return result;
}
export async function submitQuestion(id,text,photos) {
  if(!registration)throw new Error('עדיין מתחברים לקהילה. נסה שוב בעוד רגע.');
  await registration;
  if(backendConfig.uploads==='blob') {
    const {upload}=await import('@vercel/blob/client');
    const images=[];
    for(const photo of photos) {
      const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
      const extension=extensions[photo.file.type];
      if(!extension || photo.file.size>5*1024*1024)throw new Error('בחר תמונות PNG, JPEG, WebP או GIF עד 5MB לתמונה.');
      photo.uploadPath ||= `photos/${profile.id}/${id}/${requestId()}.${extension}`;
      photo.cloudImage ||= await upload(photo.uploadPath,photo.file,{access:'public',handleUploadUrl:'/api/upload',contentType:photo.file.type,clientPayload:JSON.stringify({userId:profile.id,questionId:id})});
      images.push(photo.cloudImage.url);
    }
    return api('/api/questions',{id,text,images});
  }
  const form=new FormData();form.set('id',id);form.set('text',text);
  for(const photo of photos)form.append('images',photo.file);
  return api('/api/questions',form);
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
      registration=(async()=>{
        await api('/api/profile',profile);
        backendConfig=await api('/api/config');
      })();
      await registration;
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
