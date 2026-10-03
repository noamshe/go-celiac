const MAX_BYTES=2*1024*1024;
export async function preparePhoto(file) {
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('בחר תמונת PNG, JPEG, WebP או GIF.');
  if(file.size<=MAX_BYTES)return file;
  const url=URL.createObjectURL(file);
  const image=new Image();
  try {
    image.src=url;await image.decode();
    const canvas=document.createElement('canvas');
    let scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
    for(let attempt=0;attempt<5;attempt++) {
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const context=canvas.getContext('2d');
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85-attempt*0.08));
      if(blob && blob.size<=MAX_BYTES)return blob;
      scale*=0.75;
    }
    throw new Error('לא הצלחנו להקטין את התמונה. נסה תמונה אחרת.');
  } finally { URL.revokeObjectURL(url); }
}
