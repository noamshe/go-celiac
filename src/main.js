import { createIcons, Sprout, Camera, HandHeart, ArrowLeft, ArrowRight, HeartHandshake, ImagePlus, Images, X, UserRound, Check, Bell, Users, Factory, BadgeCheck, TriangleAlert, MessageSquare, CircleHelp, ChevronLeft } from 'lucide';
import './notifications.js';
import './help.js';
import './photos.js';
import { api, connectProfile, currentState, requestId } from './live.js';
import './style.css';

const icons = { Sprout, Camera, HandHeart, ArrowLeft, ArrowRight, HeartHandshake, ImagePlus, Images, X, UserRound, Check, Bell, Users, Factory, BadgeCheck, TriangleAlert, MessageSquare, CircleHelp, ChevronLeft };
createIcons({ icons });
document.documentElement.classList.toggle('touch-device', navigator.maxTouchPoints > 0);

const home = document.querySelector('#home-screen');
const ask = document.querySelector('#ask-screen');
const help = document.querySelector('#help-screen');
const inbox = document.querySelector('#inbox-screen');
const primary = document.querySelector('.action-card.primary');
const welcome = document.querySelector('#welcome-screen');
const editProfile = document.querySelector('#edit-profile');
const nameInput = document.querySelector('#display-name');
const profileStatus = document.querySelector('#profile-status');
const profileKey = 'beyachad.profile.v1';
let profile = null;
let editingProfile = false;
function createProfileId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP addresses used to preview on a phone.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
try {
  const saved = JSON.parse(localStorage.getItem(profileKey));
  if (saved && typeof saved.id === 'string' && saved.id && typeof saved.name === 'string' && saved.name.trim() && saved.name.length <= 40) {
    profile = { id: saved.id, name: saved.name.trim() };
  }
} catch { /* An unavailable store or invalid profile starts the welcome flow. */ }
function showScreen() {
  const showWelcome = !profile || editingProfile;
  const isAsking = location.hash === '#ask';
  const isHelping = location.hash === '#help';
  const isInbox = location.hash === '#inbox';
  welcome.hidden = !showWelcome;
  home.hidden = showWelcome || isAsking || isHelping || isInbox;
  ask.hidden = showWelcome || !isAsking;
  help.hidden = showWelcome || !isHelping;
  inbox.hidden = showWelcome || !isInbox;
  const answerDialog = document.querySelector('#answer-dialog');
  if (answerDialog.open) answerDialog.close();
  editProfile.hidden = showWelcome;
  document.querySelector('#profile-name').textContent = profile?.name || '';
  document.querySelector('#cancel-profile').hidden = !editingProfile;
  document.querySelector('#profile-submit span').textContent = editingProfile ? 'שמירת השם' : 'בואו נתחיל';
  document.querySelector('#welcome-title').textContent = editingProfile ? 'איך לקרוא לך?' : 'נעים להכיר.';
  document.title = showWelcome ? 'נעים להכיר — ביחד' : isAsking ? 'שואלים את הקהילה — ביחד' : isHelping ? 'עוזרים לקהילה — ביחד' : isInbox ? 'השאלות והתשובות שלי — ביחד' : 'ביחד — הקהילה שלך ללא גלוטן';
  window.scrollTo(0, 0);
  (showWelcome ? document.querySelector('#welcome-title') : isAsking ? document.querySelector('#ask-title') : isHelping ? document.querySelector('#help-title') : isInbox ? document.querySelector('#inbox-title') : primary).focus({ preventScroll: true });
  window.dispatchEvent(new Event('screen-change'));
}
editProfile.addEventListener('click', () => {
  editingProfile = true;
  nameInput.value = profile.name;
  profileStatus.textContent = '';
  showScreen();
  nameInput.focus();
});
document.querySelector('#cancel-profile').addEventListener('click', () => { editingProfile = false; showScreen(); });
nameInput.addEventListener('input', () => {
  nameInput.removeAttribute('aria-invalid');
  profileStatus.textContent = '';
});
document.querySelector('#profile-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name || name.length > 40) {
    profileStatus.textContent = 'כתוב שם באורך של עד 40 תווים כדי להמשיך.';
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.focus();
    return;
  }
  let nextProfile;
  try {
    nextProfile = { id: profile?.id || createProfileId(), name };
    localStorage.setItem(profileKey, JSON.stringify(nextProfile));
  } catch {
    profileStatus.textContent = 'לא הצלחנו לשמור את השם. אפשר לאפשר אחסון בדפדפן ולנסות שוב.';
    return;
  }
  profile = nextProfile;
  connectProfile(profile);
  editingProfile = false;
  showScreen();
});
primary.addEventListener('click', () => { location.hash = currentState().unread > 0 ? 'inbox' : 'ask'; });
document.querySelector('#open-inbox').addEventListener('click', () => { location.hash = 'inbox'; });
document.querySelector('#back-inbox').addEventListener('click', () => { location.hash = ''; });
document.querySelector('#new-question').addEventListener('click', () => { location.hash = 'ask'; });
document.querySelector('.action-card.secondary').addEventListener('click', () => { location.hash = 'help'; });
document.querySelector('#back-home').addEventListener('click', () => { location.hash = ''; });
document.querySelector('.brand').addEventListener('click', event => {
  event.preventDefault();
  location.hash = '';
});
window.addEventListener('hashchange', showScreen);
showScreen();
if (profile) connectProfile(profile);

const gallery = document.querySelector('#gallery-input');
const camera = document.querySelector('#camera-input');
const previews = document.querySelector('#image-previews');
const uploadStatus = document.querySelector('#upload-status');
const askStatus = document.querySelector('#ask-status');
document.querySelector('#choose-gallery').addEventListener('click', () => gallery.click());
document.querySelector('#take-photo').addEventListener('click', () => camera.click());
const photos = [];
function addPhotos(event) {
  let rejected = false;
  for (const file of event.target.files) {
    if (!file.type.startsWith('image/')) { rejected = true; continue; }
    const url = URL.createObjectURL(file);
    const thumbnail = document.createElement('div');
    thumbnail.className = 'image-thumbnail';
    const image = document.createElement('img');
    image.src = url;
    image.alt = file.name;
    image.tabIndex = 0;
    image.setAttribute('role','button');
    image.setAttribute('aria-label',`פתח תמונה בגודל המקורי: ${file.name}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-image';
    remove.setAttribute('aria-label', `הסר תמונה ${file.name}`);
    remove.innerHTML = '<i data-lucide="x"></i>';
    const photo = { url, file };
    photos.push(photo);
    remove.addEventListener('click', () => {
      photos.splice(photos.indexOf(photo), 1);
      URL.revokeObjectURL(url);
      thumbnail.remove();
      uploadStatus.textContent = photos.length ? `${photos.length} תמונות נבחרו` : '';
      askStatus.textContent = '';
      document.querySelector('#choose-gallery').focus();
    });
    thumbnail.append(image, remove);
    previews.append(thumbnail);
  }
  createIcons({ icons });
  uploadStatus.textContent = rejected ? 'אפשר לבחור קובצי תמונה בלבד.' : `${photos.length} תמונות נבחרו`;
  askStatus.textContent = '';
  event.target.value = '';
}
gallery.addEventListener('change', addPhotos);
camera.addEventListener('change', addPhotos);
document.querySelector('#question-text').addEventListener('input', () => { askStatus.textContent = ''; });
let pendingQuestionId;
document.querySelector('#ask-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!photos.length && !document.querySelector('#question-text').value.trim()) {
    askStatus.textContent = 'הוסף תמונה או כתוב שאלה כדי להמשיך.';
    document.querySelector('#question-text').focus();
    return;
  }
  const submit = event.submitter || document.querySelector('#ask-form .ask-submit');
  if (submit.disabled) return;
  submit.disabled = true;
  askStatus.textContent = 'שולחים את השאלה…';
  try {
    const form = new FormData();
    pendingQuestionId ||= requestId();
    form.set('id',pendingQuestionId);
    form.set('text',document.querySelector('#question-text').value.trim());
    for (const photo of photos) form.append('images',photo.file);
    await api('/api/questions',form);
    pendingQuestionId=null;
    photos.forEach(photo=>URL.revokeObjectURL(photo.url));
    photos.length=0; previews.replaceChildren(); uploadStatus.textContent='';
    document.querySelector('#question-text').value='';
    askStatus.textContent='השאלה נשלחה לקהילה.';
    location.hash='inbox';
  } catch(error) { askStatus.textContent=error.message || 'השליחה נכשלה. אפשר לנסות שוב.'; }
  finally { submit.disabled=false; }
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) photos.forEach(photo => URL.revokeObjectURL(photo.url));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}
