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
const PUBLIC_DOMAIN = Deno.env.get("R2_PUBLIC_DOMAIN") || ""; 

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

// --- Frontend UI ---
app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>R2 Direct Linker</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>body { font-family: sans-serif; background-color: #0f172a; color: #e2e8f0; }</style>
    </head>
    <body class="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 class="text-3xl font-extrabold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
        <i class="fa-solid fa-cloud-bolt"></i> R2 Link Manager
      </h1>
      
      <div class="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700 mb-8">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div class="md:col-span-2">
            <label class="block mb-1 text-xs font-bold text-slate-400">Source URL</label>
            <input type="text" id="urlInput" placeholder="https://site.com/video.mp4" class="w-full p-3 rounded bg-slate-900 border border-slate-600 text-white text-sm">
          </div>
          <div>
            <label class="block mb-1 text-xs font-bold text-slate-400">Filename</label>
            <input type="text" id="nameInput" placeholder="Movie_Name" class="w-full p-3 rounded bg-slate-900 border border-slate-600 text-white text-sm">
          </div>
        </div>
        <button onclick="startUpload()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded shadow-lg">Upload File</button>
        
        <div id="statusArea" class="mt-4 hidden">
          <div class="flex justify-between text-xs text-slate-400 mb-1"><span id="statusText">...</span><span id="percentText">0%</span></div>
          <div class="w-full bg-slate-900 rounded-full h-2"><div id="progressBar" class="bg-blue-500 h-2 rounded-full" style="width: 0%"></div></div>
        </div>
      </div>

      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-slate-200">Recent Files</h2>
        <button onclick="loadHistory()" class="text-sm text-blue-400"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      
      <div id="historyContainer" class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-inner h-[600px] overflow-y-auto">
        <div id="historyList" class="divide-y divide-slate-700"><div class="text-center text-slate-500 py-10">Loading...</div></div>
      </div>

      <script>
        function showToast(msg) {
          const t = document.createElement('div');
          t.className = 'fixed bottom-5 right-5 bg-green-600 text-white px-4 py-2 rounded shadow-lg text-sm z-50';
          t.innerText = msg;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 2000);
        }

        function copyText(text) {
          navigator.clipboard.writeText(text);
          showToast('Copied! ✅');
        }

        // ဒီ Function က Backend ကိုလှမ်းပြီး R2 Link အစစ်ကို တောင်းပါမယ်
        async function getAndCopyDirectLink(filename, isCopy = true) {
          try {
            showToast('Generating Link... ⏳');
            // Backend API ကို ခေါ်လိုက်တယ်
            const res = await fetch(\`/api/generate-signed-url?name=\${encodeURIComponent(filename)}\`);
            const data = await res.json();
            
            if(data.url) {
               if(isCopy) {
                 copyText(data.url); // Link အရှည်ကြီးကို Copy ကူးပေးတယ်
               } else {
                 window.location.href = data.url; // Download ခလုတ်ဆိုရင် တန်းဒေါင်းခိုင်းတယ်
               }
            } else {
               alert("Error generating link");
            }
          } catch(e) {
            alert("Error: " + e.message);
          }
        }

        async function deleteHistory(ts) {
          if(!confirm("Delete?")) return;
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
            list.innerHTML += \`
              <div class="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-white text-sm truncate">\${item.filename}</h3>
                  <p class="text-xs text-slate-500">\${new Date(item.ts).toLocaleString()}</p>
                </div>
                <div class="flex gap-2">
                  <!-- Stream Link (Normal) -->
                  <button onclick="copyText('\${item.url}')" class="bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded">Stream</button>
                  
                  <!-- Copy Direct Link Button (Smart) -->
                  <button onclick="getAndCopyDirectLink('\${item.filename}', true)" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded flex items-center gap-1">
                    <i class="fa-regular fa-copy"></i> Copy DL
                  </button>

                  <!-- Direct Download Button -->
                  <button onclick="getAndCopyDirectLink('\${item.filename}', false)" class="bg-green-700 hover:bg-green-800 text-white text-xs px-3 py-2 rounded">
                    <i class="fa-solid fa-download"></i> DL Now
                  </button>
                  
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
    const r2Url = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${filename}` : `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/${filename}`;
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

// --- NEW API: Generate R2 Signed URL (String) ---
app.get("/api/generate-signed-url", async (c) => {
  const fileName = c.req.query("name");
  if (!fileName) return c.json({ error: "Filename required" }, 400);

  // Configure command for Auto Download
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    // Auto Download Header
    ResponseContentDisposition: `attachment; filename="${fileName}"`,
    // Browser Trick for no-player
    ResponseContentType: "application/octet-stream",
  });

  // Generate URL (3 hours valid)
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 10800 });

  // Return the URL string directly (JSON) instead of Redirecting
  return c.json({ url: signedUrl });
});

Deno.serve(app.fetch);
