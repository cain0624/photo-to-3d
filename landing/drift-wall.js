// Adapted from the user-supplied React Bits DriftWall; native DOM version for this HTML project.
// Keeps alternate drift, speed variance, damped pointer tilt, subtle tile lift and reduced motion.
(()=>{
 const root=document.querySelector('.drift-wall');if(!root)return;
 const plane=root.querySelector('.drift-wall__plane'),hero=document.querySelector('.hero');
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const images=Array.from({length:8},(_,i)=>`assets/wall/${i}.jpg`);
 const columns=7,tracks=[],offsets=[],velocities=[],periods=[];let visible=true,raf=0,last=0,active=null;
 const pointer={x:0,y:0},damped={x:0,y:0};
 for(let c=0;c<columns;c++){
  const col=document.createElement('div');col.className='drift-wall__col';const track=document.createElement('div');track.className='drift-wall__track';
  for(let copy=0;copy<4;copy++)for(let row=0;row<4;row++){
   const tile=document.createElement('div');tile.className='drift-wall__tile';tile.dataset.col=c;
   const inner=document.createElement('span');inner.className='drift-wall__inner';const img=document.createElement('img');img.src=images[(c*3+row)%images.length];img.alt='';img.width=560;img.height=380;img.decoding='async';img.draggable=false;inner.append(img);tile.append(inner);track.append(tile);
  }
  col.append(track);plane.append(col);tracks.push(track);offsets.push(0);velocities.push(0);
 }
 function measure(){const css=getComputedStyle(root),unit=parseFloat(css.getPropertyValue('--dw-tile-h'))+parseFloat(css.getPropertyValue('--dw-gap'));for(let c=0;c<columns;c++){periods[c]=4*unit;offsets[c]=periods[c]*((c*.37)%1);tracks[c].style.transform=`translate3d(0,${-offsets[c]}px,0)`}}
 function setActive(tile){if(active===tile)return;active?.classList.remove('is-active');active=tile;active?.classList.add('is-active')}
 function frame(ts){raf=0;if(media.matches||!visible||document.hidden){last=0;return}const dt=last?Math.min(.05,(ts-last)/1000):0;last=ts;const ease=1-Math.exp(-dt/.22);damped.x+=(pointer.x*2.4-damped.x)*ease;damped.y+=(-pointer.y*2.4-damped.y)*ease;plane.style.transform=`translate(-50%,-50%) scale(1.18) rotateX(${16+damped.y}deg) rotateY(${-14+damped.x}deg) translateZ(-120px)`;
  for(let c=0;c<columns;c++){const factor=1+.45*(((c*.6180339887+.35)%1)*2-1),target=14*factor*(c%2?-1:1);velocities[c]+=(target-velocities[c])*(1-Math.exp(-dt/0.5));offsets[c]=((offsets[c]+velocities[c]*dt)%periods[c]+periods[c])%periods[c];tracks[c].style.transform=`translate3d(0,${-offsets[c]}px,0)`}raf=requestAnimationFrame(frame)
 }
 function sync(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;if(media.matches){plane.style.transform='translate(-50%,-50%) scale(1.18) rotateX(16deg) rotateY(-14deg) translateZ(-120px)';setActive(null)}if(!media.matches&&visible&&!document.hidden)raf=requestAnimationFrame(frame);root.dataset.motion=media.matches?'reduced':'running'}
 hero.addEventListener('pointermove',e=>{if(media.matches||e.pointerType==='touch')return;const r=root.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width-.5;pointer.y=(e.clientY-r.top)/r.height-.5;setActive(e.target.closest('.drift-wall__tile'))},{passive:true});
 hero.addEventListener('pointerleave',()=>{pointer.x=pointer.y=0;setActive(null)});
 new ResizeObserver(measure).observe(root);new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync()},{threshold:0}).observe(root);
 media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);measure();sync();
})();
