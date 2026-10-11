(() => {
const $ = s => document.querySelector(s);
const video=$("#liveVideo"), shell=$("#playerShell"), overlay=$("#playerOverlay"), title=$("#overlayTitle"), message=$("#overlayMessage"), retry=$("#retryButton");
const center=$("#centerPlay"), play=$("#playButton"), mute=$("#muteButton"), full=$("#fullscreenButton"), status=$("#playerStatus"), signal=$("#signalStatus"), dot=$("#signalDot");
const sound=$("#soundToggle"), soundIcon=$("#soundIcon"), soundLabel=$("#soundLabel"), menu=$("#footerMenu"), popover=$("#footerPopover");
let hls=null, muted=true;
const viewerCount=$("#viewerCount"), viewerLabel=$("#viewerLabel");
let viewerTimer=null;
function getViewerId(){
 try{
  let id=localStorage.getItem("maha-cartoon-tv-viewer-id");
  if(!id){id=window.crypto&&crypto.randomUUID?crypto.randomUUID():"v-"+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem("maha-cartoon-tv-viewer-id",id);}
  return id;
 }catch{return "v-"+Math.random().toString(36).slice(2)+Date.now().toString(36);}
}
async function refreshViewerCount(){
 if(document.visibilityState==="hidden")return;
 try{
  const response=await fetch("/api/presence?id="+encodeURIComponent(getViewerId()),{method:"POST",cache:"no-store",headers:{"Accept":"application/json"}});
  const data=await response.json();
  if(!response.ok||!data.configured)throw new Error("Presence service not configured");
  if(viewerCount)viewerCount.textContent=String(data.count);
  if(viewerLabel)viewerLabel.textContent=data.count===1?"watching":"watching";
  const badge=document.querySelector(".viewer-badge");if(badge)badge.classList.add("viewer-ready");
 }catch{
  if(viewerCount)viewerCount.textContent="—";
  if(viewerLabel)viewerLabel.textContent="viewers";
  const badge=document.querySelector(".viewer-badge");if(badge)badge.classList.remove("viewer-ready");
 }
}
function startViewerCounter(){
 refreshViewerCount();
 viewerTimer=window.setInterval(refreshViewerCount,25000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshViewerCount();});
 window.addEventListener("pagehide",()=>{if(viewerTimer)window.clearInterval(viewerTimer);});
}
function showState(state, text) {
  if(state==="live"){overlay.hidden=true;center.hidden=!video.paused;status.textContent="Live broadcast";signal.textContent="Connected";dot.classList.remove("signal-error");return;}
  overlay.hidden=false;center.hidden=true;
  if(state==="error"){title.textContent="Broadcast unavailable";message.textContent=text||"The live stream is temporarily unavailable. Please try again.";retry.hidden=false;status.textContent="Waiting for signal";signal.textContent="Unavailable";dot.classList.add("signal-error");}
  else{title.textContent="Getting the show ready";message.textContent=text||"Connecting to the live broadcast...";retry.hidden=true;status.textContent="Connecting to live stream";signal.textContent="Connecting";dot.classList.remove("signal-error");}
}
function destroy(){if(hls){hls.destroy();hls=null;}}
function start(){
 destroy();showState("loading");video.pause();video.removeAttribute("src");video.load();video.muted=muted;
 const src="/api/live";
 if(video.canPlayType("application/vnd.apple.mpegurl")){video.src=src;video.addEventListener("loadedmetadata",()=>showState("live"),{once:true});video.addEventListener("error",()=>showState("error"),{once:true});video.play().catch(()=>status.textContent="Tap play to start");return;}
 if(window.Hls&&window.Hls.isSupported()){
  hls=new window.Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});hls.loadSource(src);hls.attachMedia(video);
  hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{showState("live");video.play().catch(()=>status.textContent="Tap play to start");});
  hls.on(window.Hls.Events.ERROR,(_e,data)=>{if(!data.fatal)return;if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR)hls.recoverMediaError();else showState("error","The stream server may be offline or suspended. Try again later.");});
  return;
 }
 showState("error","This browser cannot play HLS video.");
}
async function togglePlay(){if(video.paused){try{await video.play();}catch{showState("error","Tap play again or check whether the stream server is available.");}}else video.pause();}
function playbackUI(){const playing=!video.paused;play.textContent=playing?"Ⅱ":"▶";play.setAttribute("aria-label",playing?"Pause":"Play");center.hidden=playing||!overlay.hidden;if(playing)showState("live");}
function muteUI(){video.muted=muted;mute.textContent=muted?"◖":"◖))";mute.setAttribute("aria-label",muted?"Unmute":"Mute");soundIcon.textContent=muted?"◖":"◖))";soundLabel.textContent=muted?"Turn sound on":"Mute sound";}
play.addEventListener("click",togglePlay);center.addEventListener("click",togglePlay);video.addEventListener("play",playbackUI);video.addEventListener("pause",playbackUI);
mute.addEventListener("click",()=>{muted=!muted;muteUI();});sound.addEventListener("click",()=>{muted=!muted;muteUI();});
full.addEventListener("click",async()=>{try{if(!document.fullscreenElement)await shell.requestFullscreen();else await document.exitFullscreen();}catch{message.textContent="Fullscreen is not available in this browser."; }});
retry.addEventListener("click",start);menu.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")==="true";menu.setAttribute("aria-expanded",String(!open));menu.querySelector("span").textContent=open?"+":"−";popover.hidden=open;});
muteUI();start();startViewerCounter();
})();