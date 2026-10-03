const enableButtons=[document.querySelector('#enable-notifications'),document.querySelector('#home-notifications')];
const statuses=[document.querySelector('#notification-permission-status'),document.querySelector('#home-notification-status')];
const testButton=document.querySelector('#test-notification');
const testStatus=document.querySelector('#notification-demo-status');
let busy=false, synced=false;
function unavailableReason() {
  if(!window.isSecureContext)return 'התראות דורשות HTTPS. פתח את הכתובת המאובטחת של האפליקציה.';
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if(ios && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone===true))return 'באייפון, הוסף את האפליקציה למסך הבית ופתח אותה משם כדי לאפשר התראות (iOS 16.4 ומעלה).';
  if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window))return 'הדפדפן הזה לא תומך בהתראות Push.';
  return '';
}
function feedback(message) {for(const status of statuses)status.textContent=message;}
function refresh() {
  const reason=unavailableReason();
  const permission=reason?null:Notification.permission;
  for(const button of enableButtons){button.disabled=busy || !!reason || permission==='denied' || synced;button.querySelector('span').textContent=synced?'התראות מופעלות':'אפשר התראות במכשיר הזה';}
  feedback(reason || (permission==='denied'?'התראות חסומות. אפשר לאפשר אותן בהגדרות הדפדפן או המכשיר.':synced?'תקבל התראות על שאלות ותשובות, גם כשהאפליקציה סגורה.':'לא חובה — אפשר להמשיך גם בלי התראות.'));
}
function profile() {try{return JSON.parse(localStorage.getItem('beyachad.profile.v1'));}catch{return null;}}
async function request(url,data) {
  const response=await fetch(url,{method:data?'POST':'GET',headers:{'content-type':'application/json','x-user-id':profile()?.id || ''},...(data?{body:JSON.stringify(data)}:{})});
  let result;try{result=await response.json();}catch{throw new Error('התראות Push זמינות בגרסה המקוונת של האפליקציה.');}
  if(!response.ok)throw new Error(result.error || 'לא הצלחנו לחבר את ההתראות. נסה שוב.');
  return result;
}
function publicKeyBytes(key) {
  const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,letter=>letter.charCodeAt(0));
}
async function worker() {
  await navigator.serviceWorker.register('/sw.js');
  let timeout;
  try{return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('לא הצלחנו להכין את ההתראות. נסה שוב.')),10000);})]);}
  finally{clearTimeout(timeout);}
}
async function sync(subscription) {
  if(!profile()?.id)return false;
  await request('/api/push-subscribe',subscription.toJSON());synced=true;return true;
}
async function enable() {
  const reason=unavailableReason();if(reason)throw new Error(reason);
  // Permission must be requested directly from a tap, before network/worker awaits.
  const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
  if(permission!=='granted')throw new Error('לא ניתנה הרשאה להתראות. אפשר לשנות זאת בהגדרות המכשיר.');
  const ready=await worker();const {publicKey}=await request('/api/push-key');
  let subscription=await ready.pushManager.getSubscription();
  if(subscription && Array.from(new Uint8Array(subscription.options.applicationServerKey || [])).join(',')!==Array.from(publicKeyBytes(publicKey)).join(',')){await subscription.unsubscribe();subscription=null;}
  subscription ||= await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKeyBytes(publicKey)});
  return sync(subscription);
}
async function action(task,status) {
  if(busy)return;busy=true;refresh();testButton.disabled=true;
  let message;
  try{message=await task();}catch(error){message=error.message || 'לא הצלחנו להפעיל את ההתראות. נסה שוב.';}
  finally{busy=false;testButton.disabled=false;refresh();}
  if(status)status.textContent=message;else feedback(message);
}
for(const button of enableButtons)button.addEventListener('click',()=>void action(async()=>await enable()?'התראות מופעלות במכשיר הזה.':'ההרשאה נשמרה. אחרי הזנת השם נחבר את ההתראות לקהילה.'));
testButton.addEventListener('click',()=>void action(async()=>{
  if(!await enable())throw new Error('הזן שם לפני שליחת התראת הניסיון.');
  await request('/api/push-test',{});
  return 'השרת שלח התראת ניסיון. בדוק את מרכז ההתראות במכשיר.';
},testStatus));
window.addEventListener('community-connected',async()=>{
  if(busy || unavailableReason() || Notification.permission!=='granted')return;
  try{const subscription=await (await worker()).pushManager.getSubscription();if(subscription)await sync(subscription);refresh();}catch{synced=false;refresh();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && !busy){if(!unavailableReason() && Notification.permission!=='granted')synced=false;refresh();}});
refresh();
