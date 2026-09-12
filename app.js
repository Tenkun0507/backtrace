const GRID_SIZE=5;
const CELL_COUNT=25;
const LIMIT_MS=3000;
const FLASH_MS=200;
const MEMORIZE_STEP_MS=800;
const THREE_BACK_UNLOCK_SCORE=30;

const board=document.getElementById("board");
const scoreEl=document.getElementById("score");
const timerEl=document.getElementById("timer");
const timerStat=document.querySelector(".timer-stat");
const statusEl=document.getElementById("status");
const subStatusEl=document.getElementById("subStatus");
const bufferText=document.getElementById("bufferText");
const progressBar=document.getElementById("progressBar");
const startBtn=document.getElementById("startBtn");
const retryBtn=document.getElementById("retryBtn");
const overlayRetryBtn=document.getElementById("overlayRetryBtn");
const titleBtn=document.getElementById("titleBtn");
const overlayTitleBtn=document.getElementById("overlayTitleBtn");
const soundBtn=document.getElementById("soundBtn");
const countdownOverlay=document.getElementById("countdownOverlay");
const countdownText=document.getElementById("countdownText");
const gameOverOverlay=document.getElementById("gameOverOverlay");
const finalScoreEl=document.getElementById("finalScore");
const bestScoreEl=document.getElementById("bestScore");
const gameOverReasonEl=document.getElementById("gameOverReason");
const boardPulse=document.getElementById("boardPulse");
const signalNoise=document.getElementById("signalNoise");
const app=document.querySelector(".app");
const mode2Btn=document.getElementById("mode2Btn");
const mode3Btn=document.getElementById("mode3Btn");
const mode3Label=document.getElementById("mode3Label");
const unlockOverlay=document.getElementById("unlockOverlay");
const unlockContinueBtn=document.getElementById("unlockContinueBtn");

let cells=[],sequence=[],score=0,playing=false,acceptingInput=false;
let timerRAF=null,deadline=0,soundOn=true,audioCtx=null,flashTimeout=null;
let selectedBack=2;
let unlockShownThisRun=false;

function padScore(v){return String(v).padStart(3,"0")}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function setStatus(main,sub=""){statusEl.textContent=main;subStatusEl.textContent=sub}
function bestKey(){return selectedBack===3?"backtraceBest3":"backtraceBest2"}
function getBest(){return Number(localStorage.getItem(bestKey())||0)}
function setBest(v){localStorage.setItem(bestKey(),String(v))}
function isThreeUnlocked(){return localStorage.getItem("backtraceThreeUnlocked")==="1"}
function hasSeenThreeBackUnlock(){
  return localStorage.getItem("backtraceThreeUnlockPresented")==="1";
}

function initBoard(){
  board.innerHTML="";cells=[];
  for(let i=0;i<CELL_COUNT;i++){
    const cell=document.createElement("button");
    cell.className="cell";cell.type="button";
    cell.setAttribute("role","gridcell");
    cell.setAttribute("aria-label",`マス ${i+1}`);
    cell.addEventListener("pointerdown",()=>handleCellPress(i));
    board.appendChild(cell);cells.push(cell);
  }
}

function ensureAudio(){
  if(!audioCtx){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC)audioCtx=new AC();
  }
  if(audioCtx?.state==="suspended")audioCtx.resume();
}
function tone(freq,duration=.08,type="square",volume=.035,endFreq=null){
  if(!soundOn)return;
  ensureAudio();if(!audioCtx)return;
  const now=audioCtx.currentTime,osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(freq,now);
  if(endFreq)osc.frequency.exponentialRampToValueAtTime(endFreq,now+duration);
  gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
  osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now);osc.stop(now+duration);
}
function sfxSignal(){tone(720,.055,"square",.025,980)}
function sfxCorrect(){tone(880,.07,"sine",.045,1320);setTimeout(()=>tone(1320,.045,"sine",.025),35)}
function sfxWrong(){tone(150,.2,"sawtooth",.07,72);setTimeout(()=>tone(95,.16,"square",.045,58),45)}
function sfxButton(){tone(420,.045,"square",.024,620)}
function sfxCountdown(step){
  if(step==="MEMORIZE"){tone(980,.09,"square",.04,1480);setTimeout(()=>tone(1480,.07,"sine",.03),55);return;}
  const freq=step==="3"?420:step==="2"?520:640;
  tone(freq,.075,"square",.035,freq*1.12);
}
function sfxUnlock(){
  tone(220,.12,"sawtooth",.035,520);
  setTimeout(()=>tone(660,.09,"square",.04,980),110);
  setTimeout(()=>tone(980,.16,"sine",.045,1760),210);
}

function clearCellStates(){cells.forEach(c=>c.classList.remove("active","correct","wrong","target-reveal","ready"))}
function showNoise(){signalNoise.classList.remove("go");void signalNoise.offsetWidth;signalNoise.classList.add("go")}
function flashCell(index){
  if(flashTimeout)clearTimeout(flashTimeout);
  cells.forEach(c=>c.classList.remove("active"));
  void cells[index].offsetWidth;
  cells[index].classList.add("active");sfxSignal();
  flashTimeout=setTimeout(()=>{cells[index].classList.remove("active");showNoise()},FLASH_MS);
}
function randomCell(){return Math.floor(Math.random()*CELL_COUNT)}
function updateScore(){scoreEl.textContent=padScore(score)}
function updateBuffer(){
  const filled=Math.min(sequence.length,selectedBack);
  bufferText.textContent=`${filled} / ${selectedBack}`;
  progressBar.style.width=`${(filled/selectedBack)*100}%`;
}

function refreshModeUI(){
  const unlocked=isThreeUnlocked();
  mode3Btn.disabled=!unlocked||playing;
  mode3Btn.classList.toggle("locked",!unlocked);
  mode3Label.textContent=unlocked?"HARD MODE":"LOCKED // SCORE 30";
  mode2Btn.classList.toggle("selected",selectedBack===2);
  mode3Btn.classList.toggle("selected",selectedBack===3);
  updateBuffer();
}
function selectMode(back){
  if(playing)return;
  if(back===3&&!isThreeUnlocked())return;
  selectedBack=back;refreshModeUI();setStatus("SYSTEM READY","");
}

async function runCountdown(){
  countdownOverlay.classList.remove("hidden");
  for(const text of ["3","2","1","MEMORIZE"]){
    countdownText.textContent=text;
    countdownText.style.animation="none";void countdownText.offsetWidth;countdownText.style.animation="";
    sfxCountdown(text);
    await sleep(text==="MEMORIZE"?650:620);
  }
  countdownOverlay.classList.add("hidden");
}

async function startGame(){
  ensureAudio();stopTimer();if(flashTimeout)clearTimeout(flashTimeout);
  sequence=[];score=0;playing=true;acceptingInput=false;unlockShownThisRun=false;
  updateScore();updateBuffer();timerEl.textContent="3.00";timerStat.classList.remove("danger");clearCellStates();
  mode2Btn.disabled=true;mode3Btn.disabled=true;
  startBtn.classList.add("hidden");retryBtn.classList.add("hidden");titleBtn.classList.remove("hidden");gameOverOverlay.classList.add("hidden");
  setStatus("SYSTEM BOOT","");
  await runCountdown();if(!playing)return;

  for(let i=0;i<selectedBack;i++){
    const index=randomCell();
    sequence.push(index);updateBuffer();flashCell(index);
    setStatus(`MEMORIZE // ${String(i+1).padStart(2,"0")}`,"");
    await sleep(MEMORIZE_STEP_MS);if(!playing)return;
  }
  advancePlayableTurn();
}

function advancePlayableTurn(){
  if(!playing)return;
  acceptingInput=false;
  cells.forEach(c=>c.classList.remove("correct","wrong","target-reveal"));
  const next=randomCell();
  sequence.push(next);flashCell(next);
  cells.forEach(c=>c.classList.add("ready"));
  setStatus("TRACE","");
  acceptingInput=true;startTimer();
}

function currentTarget(){return sequence.at(-(selectedBack+1))}

function handleCellPress(index){
  if(!playing||!acceptingInput)return;
  acceptingInput=false;stopTimer();
  const target=currentTarget();

  if(index===target){
    score++;updateScore();cells[index].classList.add("correct");pulseBoard();sfxCorrect();

    setStatus("TRACE","");
    setTimeout(()=>{if(playing)advancePlayableTurn()},180);
  }else{
    cells[index].classList.add("wrong");
    if(Number.isInteger(target))cells[target].classList.add("target-reveal");
    endGame("WRONG NODE");
  }
}

function showUnlock(){
  acceptingInput=false;
  stopTimer();
  sfxUnlock();
  unlockOverlay.classList.remove("hidden");
}
function continueAfterUnlock(){
  unlockOverlay.classList.add("hidden");
  unlockShownThisRun=false;
  returnToTitle(false);
}

function startTimer(){stopTimer();deadline=performance.now()+LIMIT_MS;updateTimerFrame()}
function updateTimerFrame(now=performance.now()){
  if(!playing||!acceptingInput)return;
  const remaining=Math.max(0,deadline-now);
  timerEl.textContent=(remaining/1000).toFixed(2);
  timerStat.classList.toggle("danger",remaining<=1000);
  if(remaining<=0){
    acceptingInput=false;timerEl.textContent="0.00";
    const target=currentTarget();
    if(Number.isInteger(target))cells[target].classList.add("target-reveal");
    endGame("TIME OUT");return;
  }
  timerRAF=requestAnimationFrame(updateTimerFrame);
}
function stopTimer(){if(timerRAF)cancelAnimationFrame(timerRAF);timerRAF=null}
function pulseBoard(){boardPulse.classList.remove("go");void boardPulse.offsetWidth;boardPulse.classList.add("go")}

function endGame(reason){
  if(!playing)return;

  playing=false;
  acceptingInput=false;
  stopTimer();
  if(flashTimeout)clearTimeout(flashTimeout);

  timerStat.classList.remove("danger");
  cells.forEach(c=>c.classList.remove("ready"));
  sfxWrong();

  app.classList.remove("glitch");
  void app.offsetWidth;
  app.classList.add("glitch");

  const best=Math.max(getBest(),score);
  setBest(best);

  // The milestone is evaluated ONLY when a 2-BACK run ends.
  const reachedUnlockScore=
    selectedBack===2 &&
    score>=THREE_BACK_UNLOCK_SCORE;

  // Unlock availability and unlock ceremony are stored separately.
  // This also repairs saves from older versions that unlocked 3-BACK
  // during gameplay without ever showing the new game-over ceremony.
  const showUnlockCeremony=
    reachedUnlockScore &&
    !hasSeenThreeBackUnlock();

  if(reachedUnlockScore){
    localStorage.setItem("backtraceThreeUnlocked","1");
  }

  finalScoreEl.textContent=padScore(score);
  bestScoreEl.textContent=padScore(best);
  gameOverReasonEl.textContent=reason;
  setStatus("TRACE FAILED",reason);
  refreshModeUI();

  setTimeout(()=>{
    gameOverOverlay.classList.remove("hidden");
    retryBtn.classList.remove("hidden");
    titleBtn.classList.remove("hidden");

    if(showUnlockCeremony){
      setTimeout(()=>{
        gameOverOverlay.classList.add("hidden");
        unlockShownThisRun=true;

        // Mark the presentation only when it is actually displayed.
        localStorage.setItem("backtraceThreeUnlockPresented","1");
        showUnlock();
      },1100);
    }
  },300);
}
function returnToTitle(playSound=true){
  if(playSound)sfxButton();
  playing=false;acceptingInput=false;stopTimer();if(flashTimeout)clearTimeout(flashTimeout);
  sequence=[];score=0;clearCellStates();updateScore();updateBuffer();
  timerEl.textContent="3.00";timerStat.classList.remove("danger");
  gameOverOverlay.classList.add("hidden");
  countdownOverlay.classList.add("hidden");
  unlockOverlay.classList.add("hidden");
  retryBtn.classList.add("hidden");
  titleBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  refreshModeUI();
  mode2Btn.disabled=false;
  mode3Btn.disabled=!isThreeUnlocked();
  setStatus("SYSTEM READY","");
}

startBtn.addEventListener("click",()=>{sfxButton();startGame()});
retryBtn.addEventListener("click",()=>{sfxButton();startGame()});
overlayRetryBtn.addEventListener("click",()=>{sfxButton();startGame()});
titleBtn.addEventListener("click",()=>returnToTitle());
overlayTitleBtn.addEventListener("click",()=>returnToTitle());
mode2Btn.addEventListener("click",()=>{sfxButton();selectMode(2)});
mode3Btn.addEventListener("click",()=>{sfxButton();selectMode(3)});
unlockContinueBtn.addEventListener("click",()=>{sfxButton();continueAfterUnlock()});

soundBtn.addEventListener("click",()=>{
  if(soundOn)sfxButton();
  soundOn=!soundOn;
  soundBtn.classList.toggle("muted",!soundOn);
  soundBtn.textContent=soundOn?"♪":"×";
  if(soundOn)sfxSignal();
});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&playing&&acceptingInput)endGame("SIGNAL LOST")});

initBoard();
updateScore();
refreshModeUI();
setStatus("SYSTEM READY","");


// Prevent double-tap / double-click zoom behavior on mobile browsers.
document.addEventListener("dblclick", (e) => {
  e.preventDefault();
}, { passive: false });
