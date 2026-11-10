const raw=process.argv[2]||process.env.AUTH_MAIL_GATEWAY_URL||"";
const mode=process.argv[3]||process.env.AUTH_MAIL_EXPECT||"disabled";
if(!raw)throw new Error("Usage: node scripts/verify-health.mjs https://host [disabled|ready]");
const base=new URL(raw);
if(base.protocol!=="https:"||["localhost","127.0.0.1","::1"].includes(base.hostname))throw new Error("Health verification requires a public HTTPS URL");
const res=await fetch(new URL("/health",base),{redirect:"error",headers:{"Accept":"application/json"}});
if(!res.ok)throw new Error("Health HTTP "+res.status);
const body=await res.json();
if(body.service!=="auth-mail-gateway")throw new Error("Unexpected service");
if(body.version!=="0.3.0")throw new Error("Unexpected version: "+body.version);
if(mode==="disabled"){
  if(body.enabled!==false||body.ready!==false)throw new Error("Expected fail-closed disabled state");
}else if(mode==="ready"){
  if(body.enabled!==true||body.ready!==true)throw new Error("Expected ready state");
  if(body.email_provider!=="binding"||body.state_ready!==true||body.public_base_url_configured!==true||body.configured_apps<1)throw new Error("Ready state missing required bindings/config");
}else throw new Error("Mode must be disabled or ready");
console.log(JSON.stringify(body,null,2));
