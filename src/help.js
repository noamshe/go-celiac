import { api, currentState, requestId } from './live.js';
import { createIcons, Users, Factory, BadgeCheck, TriangleAlert, MessageSquare, CircleHelp, ChevronLeft, ArrowLeft, ArrowRight } from 'lucide';
const icons={Users,Factory,BadgeCheck,TriangleAlert,MessageSquare,CircleHelp,ChevronLeft,ArrowLeft,ArrowRight};
const dialog=document.querySelector('#answer-dialog');
const answerText=document.querySelector('#answer-text');
const answerStatus=document.querySelector('#answer-status');
let selectedQuestion, selectedChoice, answerId;
let marking=false;
const cardSides=new Map();
function el(tag,className,value) { const element=document.createElement(tag); if(className)element.className=className; if(value!==undefined)element.textContent=value; return element; }
function date(timestamp) { return new Intl.DateTimeFormat('he',{dateStyle:'short',timeStyle:'short'}).format(timestamp); }
function questionCard(question) {
  const article=el('article','live-question'); article.dataset.questionId=question.id;
  const author=el('div','question-author');
  author.append(el('span','author-avatar',question.senderName.slice(0,1)));
  const details=el('div'); details.append(el('strong','',question.senderName),el('span','question-time',date(question.createdAt)),el('span','sender-id',`מזהה: ${question.senderId}`));
  author.append(details); article.append(author);
  if(question.images.length) {
    const gallery=el('div','question-gallery');
    for(const url of question.images) { const image=el('img'); image.src=url; image.alt='תמונת המוצר שצורפה לשאלה'; image.loading='lazy'; image.tabIndex=0; image.setAttribute('role','button'); image.setAttribute('aria-label','פתח תמונה בגודל המקורי'); gallery.append(image); }
    article.append(gallery);
  }
  article.append(el('p','live-question-text',question.text || 'האם המוצר בתמונה מתאים?'));
  return article;
}
function render() {
  const state=currentState();
  const pending=state.questions.filter(q=>!q.answered).length;
  for(const [selector,count,label] of [['#help-badge',pending,'שאלות שמחכות לעזרה'],['#reply-badge',state.unread,'תשובות חדשות']]) {
    const badge=document.querySelector(selector); badge.textContent=count; badge.hidden=!count; badge.setAttribute('aria-label',`${count} ${label}`);
  }
  document.querySelector('#question-count').textContent=`${state.questions.length} שאלות`;
  const list=document.querySelector('#question-list');
  list.querySelectorAll('.swap-card').forEach(card=>card._flipObserver?.disconnect());
  list.replaceChildren();
  if(!state.questions.length)list.append(el('p','empty-state','אין עדיין שאלות מהקהילה. שאלות חדשות יופיעו כאן בזמן אמת.'));
  // The server snapshot is oldest first; reverse it to preserve ordering for ties.
  for(const question of [...state.questions].reverse()) {
    const card=questionCard(question);
    card.classList.add('swap-card');
    card.classList.toggle('is-active',!question.answered);
    const front=el('div','card-question-side');
    front.id=`question-side-${question.id}`;
    front.append(...card.childNodes);
    const back=el('div','card-answer-side');
    back.id=`answer-side-${question.id}`;
    if(question.answered)back.append(el('p','answered-label','כבר עזרת בשאלה הזו. תודה!'));
    else {
      const options=document.querySelector('#answer-template').content.cloneNode(true);
      options.querySelectorAll('.answer-option').forEach(button=>button.addEventListener('click',()=>{
        selectedQuestion=question.id; selectedChoice=button.querySelector('span').textContent; answerId=requestId();
        document.querySelector('#selected-answer').textContent=selectedChoice;
        answerText.value=''; answerStatus.textContent=''; dialog.showModal();
      }));
      back.append(options);
    }
    const tabs=el('div','card-side-tabs');
    const questionTab=el('button','','השאלה'); questionTab.type='button';
    const answerTab=el('button','','התשובה שלך'); answerTab.type='button';
    questionTab.setAttribute('aria-controls',front.id); answerTab.setAttribute('aria-controls',back.id);
    tabs.append(questionTab,answerTab);
    const toAnswer=el('button','card-swap-button','לעבור לתשובה'); toAnswer.type='button';
    const toQuestion=el('button','card-swap-button','חזרה לשאלה'); toQuestion.type='button';
    const left=el('i');left.dataset.lucide='arrow-left';toAnswer.append(left);
    const right=el('i');right.dataset.lucide='arrow-right';toQuestion.append(right);
    front.append(toAnswer);back.append(toQuestion);
    const stage=el('div','card-flip-stage');
    const rotor=el('div','card-flip-rotor');
    rotor.append(front,back);stage.append(rotor);
    card.append(tabs,stage,el('p','swipe-hint','החלק הצידה או לחץ כדי להחליף צד'));
    function resizeFace() {
      const face=card.dataset.side==='answer'?back:front;
      if(card.isConnected && face.offsetHeight)stage.style.height=`${face.offsetHeight}px`;
    }
    function setSide(answerSide) {
      cardSides.set(question.id,answerSide);
      front.inert=answerSide; back.inert=!answerSide;
      front.setAttribute('aria-hidden',String(answerSide));back.setAttribute('aria-hidden',String(!answerSide));
      questionTab.setAttribute('aria-pressed',String(!answerSide));answerTab.setAttribute('aria-pressed',String(answerSide));
      card.dataset.side=answerSide?'answer':'question';
      resizeFace();
    }
    questionTab.addEventListener('click',()=>setSide(false));toQuestion.addEventListener('click',()=>setSide(false));
    answerTab.addEventListener('click',()=>setSide(true));toAnswer.addEventListener('click',()=>setSide(true));
    let gesture;
    card.addEventListener('pointerdown',event=>{
      const gallery=event.target.closest('.question-gallery');
      if(event.target.closest('button,input,textarea,a') || (gallery && gallery.scrollWidth>gallery.clientWidth+1))return;
      if(event.pointerType==='mouse' && event.button!==0)return;
      gesture={x:event.clientX,y:event.clientY,id:event.pointerId};
    });
    card.addEventListener('pointerup',event=>{
      if(!gesture || gesture.id!==event.pointerId)return;
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      gesture=null;
      if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.4) {
        card.dataset.swipeUntil=String(Date.now()+400);
        setSide(card.dataset.side!=='answer');
      }
    });
    card.addEventListener('pointercancel',()=>{gesture=null;});
    setSide(cardSides.get(question.id) || false);
    list.append(card);
    const observer=new ResizeObserver(resizeFace);
    observer.observe(front);observer.observe(back);
    card._flipObserver=observer;
    requestAnimationFrame(resizeFace);
  }
  const inbox=document.querySelector('#inbox-list'); inbox.replaceChildren();
  const history=document.querySelector('#ask-history-list'); history.replaceChildren();
  if(!state.mine.length)history.append(el('p','empty-state','עדיין לא שאלת שאלה. השאלות שלך יופיעו כאן לאחר השליחה.'));
  if(!state.mine.length)inbox.append(el('p','empty-state','השאלות שלך והתשובות מהקהילה יופיעו כאן.'));
  for(const question of [...state.mine].reverse()) {
    const card=questionCard(question);
    const answers=state.answers.filter(a=>a.questionId===question.id);
    const historyCard=questionCard(question);
    historyCard.classList.add('history-card');
    const viewAnswers=el('button','card-swap-button',answers.length ? `צפייה בתשובות (${answers.length})` : 'מחכים לתשובות מהקהילה');
    viewAnswers.type='button';
    viewAnswers.addEventListener('click',()=>{location.hash='inbox';});
    historyCard.append(viewAnswers);history.append(historyCard);
    if(!answers.length)card.append(el('p','answer-hint','השאלה נשלחה. מחכים לתשובות מהקהילה.'));
    for(const answer of answers) {
      const reply=el('div','live-answer'); reply.dataset.answerId=answer.id;
      reply.append(el('strong','',answer.senderName),el('span','question-time',date(answer.createdAt)),el('p','',answer.choice));
      if(answer.text)reply.append(el('p','answer-extra',answer.text));
      card.append(reply);
    }
    inbox.append(card);
  }
  createIcons({icons});
  void markRead();
}
async function markRead() {
  if(marking || document.hidden || document.querySelector('#inbox-screen').hidden)return;
  const ids=currentState().answers.filter(a=>!a.readAt).map(a=>a.id);
  if(!ids.length)return;
  marking=true;
  try { await api('/api/read',{ids:ids.slice(0,1000)}); } catch { /* A failed acknowledgment leaves replies unread. */ }
  finally { marking=false; }
}
window.addEventListener('community-state',render);
window.addEventListener('screen-change',()=>void markRead());
document.addEventListener('visibilitychange',()=>void markRead());
document.querySelector('#close-answer').addEventListener('click',()=>dialog.close());
document.querySelector('#cancel-answer').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{
  const bounds=dialog.getBoundingClientRect();
  if(event.target===dialog && (event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom))dialog.close();
});
document.querySelector('#answer-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=document.querySelector('#answer-form .ask-submit');
  if(button.disabled)return; button.disabled=true; answerStatus.textContent='שולחים תשובה…';
  try {
    await api('/api/answers',{id:answerId,questionId:selectedQuestion,choice:selectedChoice,text:answerText.value.trim()});
    dialog.close();
    const toast=document.querySelector('#live-toast'); toast.textContent='תודה! התשובה נשלחה לשואל.'; toast.hidden=false; toast.onclick=()=>{toast.hidden=true;};
    clearTimeout(toast.timer); toast.timer=setTimeout(()=>{toast.hidden=true;},5000);
  } catch(error) { answerStatus.textContent=error.message; }
  finally { button.disabled=false; }
});
document.querySelector('#back-from-help').addEventListener('click',()=>{location.hash='';});
render();
