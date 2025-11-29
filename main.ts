import { Hono } from "hono";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app = new Hono();
const kv = await Deno.openKv();

// --- Configuration ---
const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") || "";
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") || "";
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") || "";
const BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") || "";
// Custom Domain မရှိရင် VPN လိုပါမယ် (ISP Block ကြောင့်)
const PUBLIC_DOMAIN = Deno.env.get("R2_PUBLIC_DOMAIN") || ""; 

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Deno Uploader Pro</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>body { font-family: sans-serif; background-color: #0f172a; color: #e2e8f0; }</style>
    </head>
    <body class="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 class="text-3xl font-extrabold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
        <i class="fa-solid fa-cloud-arrow-up"></i> Stream & Download Manager
      </h1>
      
      <div class="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700 mb-8">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div class="md:col-span-2">
            <label class="block mb-1 text-xs font-bold text-slate-400">Video Link</label>
            <input type="text" id="urlInput" placeholder="https://site.com/video.mp4" class="w-full p-3 rounded bg-slate-900 border border-slate-600 text-white text-sm">
          </div>
          <div>
            <label class="block mb-1 text-xs font-bold text-slate-400">Filename</label>
            <input type="text" id="nameInput" placeholder="My_Movie" class="w-full p-3 rounded bg-slate-900 border border-slate-600 text-white text-sm">
          </div>
        </div>
        <button onclick="startUpload()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded shadow-lg">Upload Now</button>
        
        <div id="statusArea" class="mt-4 hidden">
          <div class="flex justify-between text-xs text-slate-400 mb-1"><span id="statusText">...</span><span id="percentText">0%</span></div>
          <div class="w-full bg-slate-900 rounded-full h-2"><div id="progressBar" class="bg-blue-500 h-2 rounded-full" style="width: 0%"></div></div>
        </div>
      </div>

      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-slate-200">History List</h2>
        <button onclick="loadHistory()" class="text-sm text-blue-400"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      
      <div id="historyContainer" class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-inner h-[600px] overflow-y-auto">
        <div id="historyList" class="divide-y divide-slate-700"><div class="text-center text-slate-500 py-10">Loading...</div></div>
      </div>

      <script>
        function copyText(text) {
          navigator.clipboard.writeText(text);
          alert('Copied! ✅');
        }
        async function deleteHistory(ts) {
          if(!confirm("Remove?")) return;
          await fetch('/api/history/' + ts, { method: 'DELETE' });
          loadHistory();
        }
        async function loadHistory() {
          const res = await fetch('/api/history');
          const data = await res.json();
          const list = document.getElementById('historyList');
          list.innerHTML = '';
          if(data.length === 0) { list.innerHTML = '<div class="text-center text-slate-500 py-10">Empty.</div>'; return; }

          data.forEach(item => {
            // Bandwidth Saving Download Link
            const host = window.location.origin;
            const downloadLink = \`\${host}/api/force-download?url=\${encodeURIComponent(item.url)}&name=\${encodeURIComponent(item.filename)}\`;

            list.innerHTML += \`
              <div class="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-white text-sm truncate">\${item.filename}</h3>
                  <p class="text-xs text-slate-500">\${new Date(item.ts).toLocaleString()}</p>
                </div>
                <div class="flex gap-2">
                  <button onclick="copyText('\${item.url}')" class="bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded">Stream</button>
                  <button onclick="copyText('\${downloadLink}')" class="bg-green-700 text-white text-xs px-3 py-2 rounded">DL Link</button>
                  <button onclick="deleteHistory(\${item.ts})" class="bg-red-900 text-red-200 text-xs px-3 py-2 rounded"><i class="fa-solid fa-trash"></i></button>
                </div>
              </div>
            \`;
          });
        }
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const customName = document.getElementById('nameInput').value;
          if(!url) return alert("Link required");
          document.getElementById('statusArea').classList.remove('hidden');
          
          const startRes = await fetch('/api/upload', { method: 'POST', body: JSON.stringify({ url, customName }) });
          const { jobId } = await startRes.json();
          const interval = setInterval(async () => {
             const p = await (await fetch('/api/status/' + jobId)).json();
             if(p.status === 'processing') {
                const pct = Math.round((p.loaded/p.total)*100)||0;
                document.getElementById('progressBar').style.width = pct+'%';
                document.getElementById('percentText').innerText = pct+'%';
             } else if (p.status === 'completed') {
                clearInterval(interval);
                document.getElementById('progressBar').style.width = '100%';
                loadHistory();
             }
          }, 1000);
        }
        loadHistory();
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/api/upload", async (c) => {
  const { url, customName } = await c.req.json();
  const jobId = crypto.randomUUID();
  let filename = (customName && customName.trim()) ? customName.trim() : url.split('/').pop().split('?')[0];
  if (!filename.endsWith('.mp4')) filename += '.mp4';
  
  await kv.set(["jobs", jobId], { status: "processing", loaded: 0, total: 0 });
  runUploadTask(jobId, url, filename).catch(e => kv.set(["jobs", jobId], { status: "failed", error: e.message }));
  return c.json({ jobId });
});

async function runUploadTask(jobId, url, filename) {
  try {
    const res = await fetch(url);
    const total = Number(res.headers.get("content-length")) || 0;
    let loaded = 0;
    const stream = new TransformStream({
      transform(chunk, ctrl) {
        loaded += chunk.length;
        if (loaded % (1024*1024*2) < chunk.length || loaded === total) kv.set(["jobs", jobId], { status: "processing", loaded, total });
        ctrl.enqueue(chunk);
      }
    });
    const upload = new Upload({
      client: s3,
      params: { Bucket: BUCKET_NAME, Key: filename, Body: res.body?.pipeThrough(stream), ContentType: "video/mp4" },
    });
    await upload.done();
    const r2Url = `${PUBLIC_DOMAIN}/${filename}`;
    const ts = Date.now();
    await kv.set(["jobs", jobId], { status: "completed", url: r2Url });
    await kv.set(["history", ts], { filename, url: r2Url, ts });
  } catch (e) { await kv.set(["jobs", jobId], { status: "failed", error: e.message }); }
}

app.get("/api/status/:id", async (c) => c.json((await kv.get(["jobs", c.req.param("id")])).value || {}));
app.get("/api/history", async (c) => {
  const iter = kv.list({ prefix: ["history"] }, { limit: 50, reverse: true });
  const items = []; for await (const i of iter) items.push(i.value); return c.json(items);
});
app.delete("/api/history/:ts", async (c) => { await kv.delete(["history", Number(c.req.param("ts"))]); return c.json({ok:true}); });

// --- THE FIX (Bandwidth Saver + Auto Download) ---
app.get("/api/force-download", async (c) => {
  const fileUrl = c.req.query("url");
  const fileName = c.req.query("name") || "video.mp4";
  if (!fileUrl) return c.text("URL required", 400);

  const objectKey = fileUrl.split('/').pop();

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: objectKey,
    // (၁) Browser ကို ဒေါင်းပါလို့ ပြောမယ်
    ResponseContentDisposition: `attachment; filename="${fileName}"`,
    // (၂) Video မဟုတ်ပါဘူး၊ Binary ပါလို့ လိမ်ပြောမယ် (ဒါမှ Player မပွင့်မှာ)
    ResponseContentType: "application/octet-stream",
  });

  let signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  if (PUBLIC_DOMAIN) {
    try {
      const u = new URL(signedUrl);
      const d = new URL(PUBLIC_DOMAIN);
      u.hostname = d.hostname;
      u.protocol = d.protocol;
      signedUrl = u.toString();
    } catch (e) {}
  }

  // Deno က လမ်းကြောင်းလွှဲပေးလိုက်တာမို့ Bandwidth မကုန်ပါ
  return c.redirect(signedUrl);
});

Deno.serve(app.fetch);
