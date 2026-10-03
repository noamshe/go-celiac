const viewer=document.querySelector('#photo-viewer');
const fullPhoto=document.querySelector('#full-photo');
const canvas=document.querySelector('.photo-canvas');
const resetButton=document.querySelector('#photo-zoom-reset');
const pointers=new Map();
let scale=1,x=0,y=0,gesture;
let previousOverflow;
function draw() {
  const fit=Math.min(1,canvas.clientWidth/(fullPhoto.naturalWidth || 1),canvas.clientHeight/(fullPhoto.naturalHeight || 1));
  const limitX=Math.max(0,((fullPhoto.naturalWidth || 0)*fit*scale-canvas.clientWidth)/2);
  const limitY=Math.max(0,((fullPhoto.naturalHeight || 0)*fit*scale-canvas.clientHeight)/2);
  x=Math.max(-limitX,Math.min(limitX,x));y=Math.max(-limitY,Math.min(limitY,y));
  fullPhoto.style.transform=`translate(${x}px, ${y}px) scale(${scale})`;
  resetButton.textContent=`${Math.round(scale*100)}%`;
  canvas.classList.toggle('is-zoomed',scale>1);
}
function reset() { scale=1;x=0;y=0;pointers.clear();gesture=null;draw(); }
function point(event) {
  const bounds=canvas.getBoundingClientRect();
  return {x:event.clientX-bounds.left-bounds.width/2,y:event.clientY-bounds.top-bounds.height/2};
}
function startGesture() {
  const values=[...pointers.values()];
  if(values.length>=2) {
    const [a,b]=values;
    gesture={scale,x,y,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};
  } else if(values.length===1)gesture={x,y,point:values[0]};
  else gesture=null;
}
function zoom(next,cx=0,cy=0) {
  next=Math.max(1,Math.min(5,next));
  const ratio=next/scale;x=cx-(cx-x)*ratio;y=cy-(cy-y)*ratio;scale=next;draw();
}
canvas.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse' && event.button!==0)return;
  pointers.set(event.pointerId,point(event));
  if(event.isTrusted)canvas.setPointerCapture(event.pointerId);
  startGesture();
});
canvas.addEventListener('pointermove',event=>{
  if(!pointers.has(event.pointerId) || !gesture)return;
  pointers.set(event.pointerId,point(event));
  const values=[...pointers.values()];
  if(values.length>=2) {
    const [a,b]=values;
    scale=Math.max(1,Math.min(5,gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance));
    const ratio=scale/gesture.scale;
    x=(a.x+b.x)/2-(gesture.cx-gesture.x)*ratio;y=(a.y+b.y)/2-(gesture.cy-gesture.y)*ratio;
  } else if(gesture.point && scale>1) {x=gesture.x+values[0].x-gesture.point.x;y=gesture.y+values[0].y-gesture.point.y;}
  draw();
});
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,event=>{pointers.delete(event.pointerId);startGesture();});
canvas.addEventListener('wheel',event=>{event.preventDefault();const p=point(event);zoom(scale*Math.exp(-event.deltaY*.002),p.x,p.y);},{passive:false});
canvas.addEventListener('dblclick',event=>{const p=point(event);zoom(scale>1?1:2.5,p.x,p.y);});
document.querySelector('#photo-zoom-in').addEventListener('click',()=>zoom(scale*1.3));
document.querySelector('#photo-zoom-out').addEventListener('click',()=>zoom(scale/1.3));
resetButton.addEventListener('click',reset);
fullPhoto.addEventListener('load',draw);
window.addEventListener('resize',()=>{if(viewer.open)draw();});
function openPhoto(image) {
  if(Number(image.closest('.swap-card')?.dataset.swipeUntil || 0)>Date.now())return;
  fullPhoto.src=image.currentSrc || image.src;
  fullPhoto.alt=image.alt;
  previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  viewer.showModal();
  reset();
}
document.addEventListener('click',event=>{
  if(event.target.matches('.question-gallery img,.image-thumbnail img'))openPhoto(event.target);
});
document.addEventListener('keydown',event=>{
  if(['Enter',' '].includes(event.key) && event.target.matches('.question-gallery img,.image-thumbnail img')) {
    event.preventDefault(); openPhoto(event.target);
  }
});
function releasePhoto() {
  document.body.style.overflow=previousOverflow || '';
  previousOverflow=undefined;
  fullPhoto.removeAttribute('src');
  reset();
}
function closePhoto() { viewer.close(); releasePhoto(); }
document.querySelector('#close-photo').addEventListener('click',closePhoto);
viewer.addEventListener('cancel',event=>{event.preventDefault();closePhoto();});
viewer.addEventListener('close',()=>{
  if(!viewer.open && previousOverflow!==undefined)releasePhoto();
});
window.addEventListener('hashchange',()=>{if(viewer.open)closePhoto();});
