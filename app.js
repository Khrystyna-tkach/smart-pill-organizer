"use strict";
// Smart Pill Organizer PWA · Quiet Health · ESP32-authoritative statuses
// The device, not the browser, decides what is complete/missed.
const $ = id => document.getElementById(id);
const STORAGE = {settings: "pillbox-quiet-settings-v1", events: "pillbox-quiet-events-v1"};
const NAMES = {MORNING:"Ранок", LUNCH:"Обід", EVENING:"Вечір"};
const DOSES = [["morning","MORNING","i-sun"],["lunch","LUNCH","i-sun"],["evening","EVENING","i-moon"]];
const EVENTS = {
 boot:"Запуск ESP32", mqtt_connected:"MQTT підключено", time_synchronized:"Час синхронізовано",
 lid_opened:"Кришку відкрито", lid_closed:"Кришку закрито", dose_due:"Настав час нагадування",
 dose_confirmed:"Дозу позначено завершеною", dose_missed:"Нагадування пропущено",
 lid_open_too_long:"Кришка надто довго відкрита", schedule_changed:"Розклад змінено",
 schedule_rejected:"Зміну розкладу відхилено", manual_test:"Тестова MQTT-подія"
};
const svgNS = "http://www.w3.org/2000/svg";
let mqttClient = null, base = "", connected = false, activeDevice = "pill-lab";
let status = null, schedule = null, available = null, weekly = null;
let events = [];
try { events = JSON.parse(localStorage.getItem(STORAGE.events) || "[]"); if(!Array.isArray(events)) events=[]; }catch{events=[];}
const fmtTime=d=>d.toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit"});
const localDateKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const validHHMM=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const set=(id,v)=>{ const x=$(id); if(x)x.textContent=String(v??"—");};
const icon=(name)=>{const svg=document.createElementNS(svgNS,"svg");svg.classList.add("icon"); const u=document.createElementNS(svgNS,"use");u.setAttribute("href",`#${name}`);svg.append(u);return svg;};

// Tabs are semantic buttons, no router or framework needed.
function tab(name){
 document.querySelectorAll(".nav-item").forEach(b=>{const yes=b.dataset.tab===name; b.classList.toggle("active",yes); if(yes)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
 document.querySelectorAll(".view").forEach(v=>v.classList.toggle("hidden",v.id!==`view-${name}`));
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>tab(b.dataset.tab)));
function connectedUI(ok,detail){
 connected=ok;
 $("topConnection").classList.toggle("is-connected",ok);
 $("connectOrb").classList.toggle("online",ok);
 set("topConnectionText",ok?"MQTT підключено":"MQTT офлайн");
 set("connectState",ok?"Підключено":"Не підключено");
 set("connectDetail",detail);
 $("saveSchedule").disabled=!ok;
 $("connectBtn").disabled=ok;
 set("deviceNetwork",ok?"MQTT з'єднання встановлено":"Очікується MQTT");
 renderOverview();
}
function renderOverview(){
 set("deviceName",activeDevice);
 const isOnline=connected&&available===true;
 $("deviceDot").classList.toggle("online",isOnline);
 $("deviceDot").setAttribute("aria-label",isOnline?"Пристрій онлайн":"Пристрій офлайн або статус невідомий");
 set("deviceNetwork",isOnline?"Пристрій онлайн · MQTT":connected?"З'єднано, стан ESP32 невідомий":"Очікується MQTT");
 set("lid",!status?"Немає даних":status.lid==="OPEN"?"відкрита":status.lid==="CLOSED"?"закрита":"невідомо");
 renderDoses();
 const now=new Date();
 const activeKey=DOSES.find(([key,name])=>status?.active_dose===name);
 if(activeKey){set("nextDose",`Зараз · ${NAMES[activeKey[1]]}`);set("nextHint","Активне нагадування — відкрийте та закрийте кришку");return;}
 const upcoming=DOSES.filter(([key,_,__],i)=>schedule?.[key]&&!status?.completed?.[i]&&!status?.missed?.[i])
   .find(([key])=>{const v=schedule[key];return validHHMM(v)&&v>fmtTime(now);});
 if(upcoming){set("nextDose",schedule[upcoming[0]]);set("nextHint",`${NAMES[upcoming[1]]} · за поточним розкладом`);return;}
 if(status&&schedule){set("nextDose","На сьогодні все");set("nextHint","Немає активних нагадувань");}
 else{set("nextDose","Немає даних");set("nextHint","Зачекайте на статус ESP32");}
}
function renderDoses(){
 const root=$("doseList");root.replaceChildren();
 if(!schedule){const div=document.createElement("div");div.className="empty-state";div.textContent="Ще немає розкладу з ESP32. Під'єднайте MQTT.";root.append(div);return;}
 DOSES.forEach(([key,name,ico],i)=>{
   const el=document.createElement("div");el.className="dose-row";
   const symbol=document.createElement("div");symbol.className=`dose-icon ${key}`;symbol.append(icon(ico));
   const text=document.createElement("div");text.className="dose-text";
   const title=document.createElement("strong");title.textContent=NAMES[name];
   const sub=document.createElement("small");sub.textContent=schedule[key];text.append(title,sub);
   const badge=document.createElement("span");badge.className="pill";
   const completed=Boolean(status?.completed?.[i]),missed=Boolean(status?.missed?.[i]),active=status?.active_dose===name;
   if(completed){badge.textContent="Завершено";badge.classList.add("completed");}
   else if(missed){badge.textContent="Пропущено";badge.classList.add("missed");}
   else if(active){badge.textContent="Нагадування";badge.classList.add("active");}
   else{badge.textContent="Очікується";badge.classList.add("planned");}
   el.append(symbol,text,badge);root.append(el);
 });
}
function drawWeekly(){
 const chart=$("weekChart");chart.replaceChildren();
 const series=Array.isArray(weekly?.days)?weekly.days:[];
 const keyed=new Map(series.filter(d=>d&&/^\d{4}-\d\d-\d\d$/.test(d.date)).map(d=>[d.date,d]));
 const end=new Date();end.setHours(12,0,0,0);
 const days=Array.from({length:7},(_,i)=>{const d=new Date(end);d.setDate(end.getDate()-(6-i));return {date:localDateKey(d),label:["Нд","Пн","Вт","Ср","Чт","Пт","Сб"][d.getDay()],summary:keyed.get(localDateKey(d))};});
 const x0=29,yBase=172,maxHeight=120,scale=maxHeight/3,step=43.5;
 const add=(tag,attrs={},text)=>{const e=document.createElementNS(svgNS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));if(text!==undefined)e.textContent=String(text);chart.append(e);return e;};
 [0,1,2,3].forEach(v=>{const y=yBase-v*scale;add("line",{x1:25,y1:y,x2:337,y2:y,stroke:"#E8EEE8","stroke-width":1,"stroke-dasharray":v===0?"0":"2 5"});add("text",{x:13,y:y+4,fill:"#7E8A81","font-size":10,"text-anchor":"middle"},v);});
 let done=0,missed=0,coverage=0;
 days.forEach((d,i)=>{
  const x=x0+9+i*step;
  if(!d.summary){add("rect",{x,y:yBase-8,width:29,height:8,rx:4,fill:"#E8ECE8"});}
  else{
    coverage++;
    const c=Math.min(3,Math.max(0,Number(d.summary.completed)||0));
    const m=Math.min(3,Math.max(0,Number(d.summary.missed)||0));
    done+=c;missed+=m;
    // Stacked IoT telemetry: known confirmed and missed outcomes; no data is neutral.
    if(c>0)add("rect",{x,y:yBase-scale*c,width:29,height:scale*c,rx:4,fill:"#96BDA5"});
    if(m>0)add("rect",{x,y:yBase-scale*(c+m),width:29,height:scale*m,rx:4,fill:"#D9A496"});
    if(c===0&&m===0)add("circle",{cx:x+14.5,cy:yBase-4,r:3.5,fill:"#B8C8BD"});
    const tip=add("title");tip.textContent=`${d.date}: завершено ${c}, пропущено ${m}`;
  }
  add("text",{x:x+14.5,y:yBase+18,fill:"#718078","font-size":11,"text-anchor":"middle"},d.label);
 });
 set("weekCount",coverage?done:"—");set("weekMissed",coverage?missed:"—");
 set("weekRate",(done+missed)>0?`${Math.round(done/(done+missed)*100)} %`:"—");
 set("weekNote",coverage?`Є підсумки за ${coverage} із 7 днів. Відсутність запису — не пропуск.`:"Немає тижневих підсумків від ESP32. Перевірте підписку на weekly.");
}
function renderEvents(){
 const root=$("events");root.replaceChildren();
 if(!events.length){const el=document.createElement("div");el.className="empty-state";el.textContent="У цьому браузері ще немає подій.";root.append(el);return;}
 events.slice(0,65).forEach(e=>{
  const row=document.createElement("div");row.className="event-row";
  const ico=document.createElement("div");ico.className="event-icon";
  if(e.event==="dose_missed")ico.classList.add("warn");
  ico.append(icon(e.event==="dose_missed"?"i-clock":e.event==="dose_due"?"i-bell":e.event==="dose_confirmed"?"i-check":"i-box"));
  const text=document.createElement("div");text.className="event-data";
  const title=document.createElement("strong");title.textContent=EVENTS[e.event]||String(e.event||"Подія");
  const subtitle=document.createElement("span");subtitle.textContent=e.dose&&e.dose!=="NONE"?`Доза: ${NAMES[e.dose]||e.dose}`:`Кришка: ${e.lid||"—"}`;
  text.append(title,subtitle);
  const dt=document.createElement("span");dt.className="event-time";dt.textContent=e.displayTime||"";
  row.append(ico,text,dt);root.append(row);
 });
}
function appendEvent(data){
 const epoch=Number(data.epoch)||0;
 const when=epoch>1700000000?new Date(epoch*1000):new Date();
 const record={event:String(data.event||""),dose:data.dose,lid:data.lid,when:when.toISOString(),displayTime:fmtTime(when)};
 // Basic duplicate suppression for reconnect race; no guarantees for QoS0 history.
 if(events[0]?.event===record.event && events[0]?.dose===record.dose && events[0]?.when===record.when) return;
 events.unshift(record);
 const limit=new Date();limit.setDate(limit.getDate()-7);
 events=events.filter(e=>new Date(e.when)>=limit).slice(0,160);
 try{localStorage.setItem(STORAGE.events,JSON.stringify(events));}catch{}
 renderEvents();
}
function message(topic,buffer){
 if(!topic.startsWith(base+"/"))return;
 const kind=topic.slice(base.length+1);
 const txt=buffer.toString();
 if(kind==="availability"){available=txt==="online";renderOverview();return;}
 let data;try{data=JSON.parse(txt)}catch{return;}
 if(!data||typeof data!=="object"||data.device!==activeDevice)return;
 if(kind==="status"){
  status=data;set("lastSeen",`Оновлено ${fmtTime(new Date())}`);renderOverview();
 }else if(kind==="schedule"){
  if(["morning","lunch","evening"].every(k=>validHHMM(data[k]))){
   schedule=data;for(const k of ["morning","lunch","evening"])$(k).value=data[k];
   set("scheduleInfo","ESP32 підтвердила актуальний розклад.");renderOverview();
  }
 }else if(kind==="events"){
  appendEvent(data);
  if(data.event==="schedule_rejected")set("scheduleInfo","ESP32 відхилила команду. Перевір порядок годин.");
 }else if(kind==="weekly"){
  if(Array.isArray(data.days)){weekly=data;drawWeekly();}
 }
}
function disconnect(show=true){
 if(mqttClient){mqttClient.removeAllListeners();mqttClient.end(true);mqttClient=null;}
 available=null;
 if(show)connectedUI(false,"Підключення вимкнено.");
}
function connect(e){
 e?.preventDefault();
 if(typeof mqtt==="undefined"){connectedUI(false,"MQTT.js не завантажено. Перевірте інтернет.");return;}
 const host=$("host").value.trim(),id=$("device").value.trim(),username=$("username").value.trim(),password=$("password").value;
 if(!/^[A-Za-z0-9.-]+$/.test(host)||!host.includes(".")||!/^[A-Za-z0-9-]{1,32}$/.test(id)||!username||!password){connectedUI(false,"Заповніть адресу брокера, ID, логін і пароль.");return;}
 disconnect(false);activeDevice=id;base=`pillbox/${id}`;status=null;schedule=null;weekly=null;available=null;drawWeekly();renderOverview();
 try{localStorage.setItem(STORAGE.settings,JSON.stringify({host,device:id,username}));}catch{}
 connectedUI(false,"Установлюємо захищене з'єднання WSS…");
 try{mqttClient=mqtt.connect(`wss://${host}:8084/mqtt`,{clientId:`pillbox-pwa-${Math.random().toString(16).slice(2,10)}`,username,password,protocolVersion:4,reconnectPeriod:5000,keepalive:45,connectTimeout:15000,clean:true});}
 catch(err){connectedUI(false,`Помилка: ${err.message}`);return;}
 $("password").value="";
 mqttClient.on("connect",()=>{
  connectedUI(true,"WSS/TLS підключено. Очікуємо дані ESP32.");
  mqttClient.subscribe(`${base}/+`,{qos:0},err=>{if(err)set("connectDetail","MQTT з'єднано, але підписка недоступна. Перевірте ACL.");});
 });
 mqttClient.on("reconnect",()=>connectedUI(false,"Повторне MQTT-підключення…"));
 mqttClient.on("close",()=>connectedUI(false,"З'єднання втрачено. Очікуємо перепідключення."));
 mqttClient.on("error",err=>connectedUI(false,`Помилка MQTT: ${err.message}`));
 mqttClient.on("message",message);
}
$("connectionForm").addEventListener("submit",connect);
$("disconnectBtn").addEventListener("click",()=>disconnect());
$("saveSchedule").addEventListener("click",()=>{
 if(!mqttClient?.connected){set("scheduleInfo","MQTT зараз не підключений.");return;}
 const times=["morning","lunch","evening"].map(k=>$(k).value);
 if(!times.every(validHHMM)||!(times[0]<times[1]&&times[1]<times[2])){set("scheduleInfo","Введіть три різні години у зростаючому порядку.");return;}
 set("scheduleInfo","Надіслано MQTT-команду. Чекаємо підтвердження ESP32…");
 mqttClient.publish(`${base}/cmd/schedule`,times.join(","),{qos:1,retain:false},err=>{if(err)set("scheduleInfo",`Помилка надсилання: ${err.message}`);});
});
$("clearHistory").addEventListener("click",()=>{events=[];try{localStorage.removeItem(STORAGE.events)}catch{}renderEvents();});
try{const saved=JSON.parse(localStorage.getItem(STORAGE.settings)||"{}");for(const k of ["host","device","username"])if(saved[k])$(k).value=saved[k];}catch{}
set("todayDate",new Date().toLocaleDateString("uk-UA",{day:"numeric",month:"long",weekday:"long"}));
renderEvents();renderOverview();drawWeekly();connectedUI(false,"Уведіть дані EMQX на вкладці «З'єднання».");
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
