import { Hono } from "hono";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app = new Hono();
const kv = await Deno.openKv();

// --- Configuration (Environment Variables) ---
const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") || "";
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") || "";
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") || "";
const BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") || "";
// အရေးကြီး: Custom Domain ရှိရင်ထည့်ပါ (ဥပမာ: https://dl.mymovie.com)
// Custom Domain မရှိရင် VPN လိုနိုင်ပါတယ်
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
      <title>Deno Uploader Pro</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        body { font-family: sans-serif; background-color: #0f172a; color: #e2e8f0; }
        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1e293b; }
        ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #64748b; }
      </style>
    </head>
    <body class="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 class="text-3xl font-extrabold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
        <i class="fa-solid fa-cloud-arrow-up"></i> Stream & Download Manager
      </h1>
      
      <!-- Upload Box -->
      <div class="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700 mb-8">
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <!-- URL Input -->
          <div class="md:col-span-2">
            <label class="block mb-1 text-xs font-bold text-slate-400">Video Link</label>
            <input type="text" id="urlInput" placeholder="https://site.com/video.mp4" class="w-full p-3 rounded bg-slate-900 border border-slate-600 focus:border-blue-500 text-white text-sm">
          </div>
          <!-- Rename Input -->
          <div>
            <label class="block mb-1 text-xs font-bold text-slate-400">Filename (Optional)</label>
            <input type="text" id="nameInput" placeholder="My_Movie_Name" class="w-full p-3 rounded bg-slate-900 border border-slate-600 focus:border-purple-500 text-white text-sm">
          </div>
        </div>

        <button onclick="startUpload()" class="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-3 rounded shadow-lg transition transform active:scale-95">
          <i class="fa-solid fa-rocket"></i> Upload Now
        </button>
        
        <!-- Progress Bar -->
        <div id="statusArea" class="mt-4 hidden">
          <div class="flex justify-between text-xs text-slate-400 mb-1">
            <span id="statusText">Starting...</span>
            <span id="percentText">0%</span>
          </div>
          <div class="w-full bg-slate-900 rounded-full h-2">
            <div id="progressBar" class="bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
        </div>
      </div>

      <!-- History Section -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-slate-200"><i class="fa-solid fa-list"></i> History List</h2>
        <button onclick="loadHistory()" class="text-sm text-blue-400 hover:text-white transition"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      
      <!-- Scrollable History Container (Height fixed to 600px) -->
      <div id="historyContainer" class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-inner h-[600px] overflow-y-auto relative">
        <div id="historyList" class="divide-y divide-slate-700">
          <div class="text-center text-slate-500 py-10">Loading history...</div>
        </div>
      </div>

      <script>
        // Copy function
        function copyText(text) {
          navigator.clipboard.writeText(text);
          const toast = document.createElement('div');
          toast.className = 'fixed bottom-5 right-5 bg-green-600 text-white px-4 py-2 rounded shadow-lg text-sm z-50';
          toast.innerText = 'Copied! ✅';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 2000);
        }

        async function deleteHistory(ts) {
          if(!confirm("Delete from history list?")) return;
          await fetch('/api/history/' + ts, { method: 'DELETE' });
          loadHistory();
        }

        async function loadHistory() {
          const res = await fetch('/api/history');
          const data = await res.json();
          const list = document.getElementById('historyList');
          list.innerHTML = '';
          
          if(data.length === 0) { list.innerHTML = '<div class="text-center text-slate-500 py-10">No files found.</div>'; return; }

          data.forEach(item => {
            // Generate Download Link (Points to Deno API)
            const host = window.location.origin;
            const downloadLink = \`\${host}/api/force-download?url=\${encodeURIComponent(item.url)}&name=\${encodeURIComponent(item.filename)}\`;

            list.innerHTML += \`
              <div class="p-4 hover:bg-slate-750 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group">
                
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-white text-sm truncate mb-1" title="\${item.filename}">\${item.filename}</h3>
                  <p class="text-xs text-slate-500">\${new Date(item.ts).toLocaleString()}</p>
                </div>

                <div class="flex flex-wrap gap-2 w-full sm:w-auto">
                  
                  <!-- Copy Stream Link -->
                  <button onclick="copyText('\${item.url}')" class="bg-slate-700 hover:bg-blue-600 text-slate-200 text-xs px-3 py-2 rounded border border-slate-600 flex items-center gap-2 transition">
                    <i class="fa-regular fa-copy"></i> Stream
                  </button>

                  <!-- Copy Download Link -->
                  <button onclick="copyText('\${downloadLink}')" class="bg-slate-700 hover:bg-green-600 text-slate-200 text-xs px-3 py-2 rounded border border-slate-600 flex items-center gap-2 transition">
                    <i class="fa-solid fa-download"></i> DL Link
                  </button>
                  
                  <!-- Delete Button -->
                  <button onclick="deleteHistory(\${item.ts})" class="bg-slate-700 hover:bg-red-600 text-slate-400 hover:text-white text-xs px-3 py-2 rounded border border-slate-600 transition ml-auto sm:ml-0" title="Remove">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>

              </div>
            \`;
          });
        }

        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const customName = document.getElementById('nameInput').value;

          if(!url) return alert("Link is required!");

          const statusArea = document.getElementById('statusArea');
          const progressBar = document.getElementById('progressBar');
          const statusText = document.getElementById('statusText');
          const percentText = document.getElementById('percentText');
          
          statusArea.classList.remove('hidden');
          statusText.innerText = "Processing...";
          progressBar.style.width = '0%';
          percentText.innerText = '0%';

          try {
            const startRes = await fetch('/api/upload', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ url, customName })
            });
            const { jobId } = await startRes.json();

            const interval = setInterval(async () => {
              const pollRes = await fetch('/api/status/' + jobId);
              const pollData = await pollRes.json();

              if (pollData.status === 'processing') {
                const pct = Math.round((pollData.loaded / pollData.total) * 100) || 0;
                progressBar.style.width = pct + '%';
                percentText.innerText = pct + '%';
                statusText.innerText = \`Uploading... \${(pollData.loaded/1024/1024).toFixed(1)} MB\`;
              } else if (pollData.status === 'completed') {
                clearInterval(interval);
                progressBar.style.width = '100%';
                percentText.innerText = '100%';
                statusText.innerText = "Success!";
                setTimeout(() => {
                   statusArea.classList.add('hidden');
                   loadHistory();
                   document.getElementById('urlInput').value = '';
                   document.getElementById('nameInput').value = '';
                }, 1000);
              } else if (pollData.status === 'failed') {
                clearInterval(interval);
                progressBar.classList.add('bg-red-600');
                statusText.innerText = "Error: " + pollData.error;
              }
            }, 1000);

          } catch (e) {
            alert("System Error: " + e.message);
          }
        }

        loadHistory();
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

// --- API: Upload ---
app.post("/api/upload", async (c) => {
  const { url, customName } = await c.req.json();
  const jobId = crypto.randomUUID();

  // Rename Logic
  let filename;
  if (customName && customName.trim() !== "") {
    filename = customName.trim();
    if (!filename.endsWith('.mp4')) filename += '.mp4';
  } else {
    // Default name from URL
    filename = url.split('/').pop().split('?')[0];
    if (!filename.endsWith('.mp4')) filename += '.mp4';
  }

  await kv.set(["jobs", jobId], { status: "processing", loaded: 0, total: 0 });
  
  runUploadTask(jobId, url, filename).catch(err => {
    kv.set(["jobs", jobId], { status: "failed", error: err.message });
  });

  return c.json({ jobId });
});

async function runUploadTask(jobId: string, url: string, filename: string) {
  try {
    const sourceRes = await fetch(url);
    const totalSize = Number(sourceRes.headers.get("content-length")) || 0;
    
    let loaded = 0;
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        loaded += chunk.length;
        if (loaded % (1024 * 1024 * 2) < chunk.length || loaded === totalSize) {
             kv.set(["jobs", jobId], { status: "processing", loaded, total: totalSize });
        }
        controller.enqueue(chunk);
      }
    });

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: BUCKET_NAME,
        Key: filename,
        Body: sourceRes.body?.pipeThrough(transformStream),
        ContentType: "video/mp4",
      },
    });

    await upload.done();
    const r2Url = `${PUBLIC_DOMAIN}/${filename}`;
    
    // Save to History
    const ts = Date.now();
    await kv.set(["jobs", jobId], { status: "completed", url: r2Url });
    await kv.set(["history", ts], { filename, url: r2Url, ts: ts });
    
  } catch (err) {
    await kv.set(["jobs", jobId], { status: "failed", error: err.message });
  }
}

// --- API: Status, History List, Delete ---
app.get("/api/status/:id", async (c) => {
  const result = await kv.get(["jobs", c.req.param("id")]);
  return c.json(result.value || {});
});

app.get("/api/history", async (c) => {
  const entries = kv.list({ prefix: ["history"] }, { limit: 50, reverse: true });
  const history = [];
  for await (const entry of entries) history.push(entry.value);
  return c.json(history);
});

app.delete("/api/history/:ts", async (c) => {
  const ts = Number(c.req.param("ts"));
  await kv.delete(["history", ts]);
  return c.json({ success: true });
});

// --- API: Smart Download (Bandwidth Saver & VPN Bypass) ---
app.get("/api/force-download", async (c) => {
  const fileUrl = c.req.query("url");
  const fileName = c.req.query("name") || "video.mp4";

  if (!fileUrl) return c.text("URL required", 400);

  // Extract Key from URL
  const objectKey = fileUrl.split('/').pop();

  // Create Command to force download
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${fileName}"`,
  });

  // Generate Signed URL (valid for 1 hour)
  let signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  // Domain Replacement for VPN Bypass
  if (PUBLIC_DOMAIN) {
    try {
      // Create objects to manipulate URL
      const customDomainObj = new URL(PUBLIC_DOMAIN);
      const originalUrlObj = new URL(signedUrl);
      
      // Swap the hostname (e.g., xxx.r2.cloudflarestorage.com -> dl.mymovie.com)
      originalUrlObj.hostname = customDomainObj.hostname;
      originalUrlObj.protocol = customDomainObj.protocol;

      // Update signedUrl with new domain
      signedUrl = originalUrlObj.toString();
    } catch (e) {
      console.error("Domain replacement failed:", e);
    }
  }

  // Redirect user to the new Signed URL
  return c.redirect(signedUrl);
});

Deno.serve(app.fetch);
