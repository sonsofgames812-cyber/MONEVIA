const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentUser = null, authMode = "register", currentCategory = "all";
const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase(), maximumFractionDigits: 2 }).format(Number(cents) / 100);
async function api(url, options={}) {
  const response = await fetch(url, { credentials:"same-origin", ...options, headers:{ ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers||{}) } });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),3000); }
function openDialog(id) { $(id).showModal(); }
function closeDialogs() { $$("dialog").forEach(d=>d.close()); }
$$("[data-close]").forEach(b=>b.addEventListener("click",closeDialogs));
function setAuthMode(mode) {
  authMode=mode;
  $("#authTitle").textContent=mode==="register"?"Create your account":"Welcome back";
  $("#authSubmit").textContent=mode==="register"?"Create account":"Sign in";
  $("#nameLabel").hidden=mode!=="register";
  $("#nameLabel input").required=mode==="register";
  $("#authForm [name=password]").autocomplete=mode==="register"?"new-password":"current-password";
  $("#switchText").textContent=mode==="register"?"Already have an account?":"New to MONEVIA?";
  $("#switchAuth").textContent=mode==="register"?"Sign in":"Create account";
  $("#authError").textContent="";
}
function showAuth(mode="register"){setAuthMode(mode);openDialog("#authDialog");}
$("#authBtn").addEventListener("click",()=>currentUser?showAccount():showAuth("login"));
$("#getStarted").addEventListener("click",()=>currentUser?showAccount():showAuth("register"));
$("#switchAuth").addEventListener("click",()=>setAuthMode(authMode==="register"?"login":"register"));
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();$("#authError").textContent="";
  const f=new FormData(e.currentTarget), body={email:f.get("email"),password:f.get("password")};
  if(authMode==="register")body.name=f.get("name");
  try{const data=await api(`/api/auth/${authMode}`,{method:"POST",body:JSON.stringify(body)});currentUser=data.user;closeDialogs();renderUser();toast(authMode==="register"?"Account created. Welcome to MONEVIA!":"Welcome back!");}
  catch(err){$("#authError").textContent=err.message;}
});
function renderUser(){const b=$("#authBtn");b.textContent=currentUser?currentUser.name.split(" ")[0]:"Sign in";$("#createListing").textContent=currentUser?"＋ Create listing":"＋ Sign in to list";loadListings();}
$("#createListing").addEventListener("click",()=>currentUser?openDialog("#listingDialog"):showAuth("register"));
$("#listingForm").addEventListener("submit",async e=>{
  e.preventDefault();$("#listingError").textContent="";
  const f=new FormData(e.currentTarget), price=Math.round(Number(f.get("price"))*100);
  try{await api("/api/listings",{method:"POST",body:JSON.stringify({title:f.get("title"),description:f.get("description"),category:f.get("category"),amountCents:price,currency:f.get("currency")})});closeDialogs();e.currentTarget.reset();toast("Listing published.");loadListings();}
  catch(err){$("#listingError").textContent=err.message;}
});
$$(".filter").forEach(b=>b.addEventListener("click",()=>{$$(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentCategory=b.dataset.category;loadListings();}));
async function loadListings(){
 const container=$("#listings");container.innerHTML='<div class="empty-state">Loading opportunities…</div>';
 try{
  const data=await api("/api/listings"+(currentCategory!=="all"?"?category="+encodeURIComponent(currentCategory):""));
  if(!data.listings.length){container.innerHTML='<div class="empty-state">No listings yet. Be the first to publish a useful service, digital product, or task.</div>';return;}
  container.innerHTML=data.listings.map(l=>`<article class="listing"><div class="listing-top"><span class="tag">${escapeHtml(l.category.replace("_"," "))}</span><span class="seller">by ${escapeHtml(l.seller_name)}</span></div><h3>${escapeHtml(l.title)}</h3><p>${escapeHtml(l.description)}</p><div class="listing-foot"><span class="price">${money(l.amount_cents,l.currency)}</span><button class="btn btn-primary buy" data-buy="${l.id}">View / buy ↗</button></div></article>`).join("");
  $$("[data-buy]").forEach(b=>b.addEventListener("click",()=>buyListing(b.dataset.buy)));
 }catch(err){container.innerHTML=`<div class="empty-state">${escapeHtml(err.message)} <button class="btn btn-outline" id="retryListings">Retry</button></div>`;$("#retryListings")?.addEventListener("click",loadListings);}
}
async function buyListing(id){
 if(!currentUser){showAuth("register");return;}
 if(!confirm("Continue to secure checkout? Only pay for an offer you understand and expect to receive."))return;
 try{const data=await api(`/api/orders/${id}/checkout`,{method:"POST",body:"{}"});location.href=data.checkoutUrl;}
 catch(err){toast(err.message);}
}
async function showAccount(){
 if(!currentUser){showAuth("login");return;}
 $("#accountName").textContent=currentUser.name;$("#accountEmail").textContent=currentUser.email;$("#accountError").textContent="";
 openDialog("#accountDialog");
 try{
  const data=await api("/api/wallet");
  $("#balances").innerHTML=data.balances.length?data.balances.map(b=>`<div class="balance"><span>Recorded balance</span><strong style="float:right">${money(b.balance_cents,b.currency)}</strong></div>`).join(""):'<div class="balance">No recorded earnings yet. Complete a real sale to create a balance.</div>';
  $("#payouts").innerHTML=data.payouts.length?data.payouts.map(p=>`<div class="payout-row">${money(p.amount_cents,p.currency)} · ${escapeHtml(p.status)} · ${new Date(p.created_at).toLocaleDateString()}</div>`).join(""):"No payout requests yet.";
 }catch(err){$("#accountError").textContent=err.message;}
}
$("#payoutForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#accountError").textContent="";const f=new FormData(e.currentTarget);
 try{await api("/api/payouts",{method:"POST",body:JSON.stringify({amountCents:Math.round(Number(f.get("amount"))*100),currency:f.get("currency")})});toast("Payout request submitted for review.");showAccount();}
 catch(err){$("#accountError").textContent=err.message;}
});
$("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",body:"{}"});currentUser=null;closeDialogs();renderUser();toast("Signed out.");}catch(e){toast(e.message);}});
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
(async()=>{
 $("#year").textContent=new Date().getFullYear();
 try{const d=await api("/api/auth/me");currentUser=d.user;renderUser();}catch{}
 const params=new URLSearchParams(location.search);
 if(params.get("payment")==="success")toast("Payment return received. Your balance updates after verified Stripe webhook confirmation.");
 if(params.get("payment")==="cancelled")toast("Checkout cancelled. No payment was completed.");
 if(params.has("payment"))history.replaceState({}, "", "/");
 loadListings();
})();
