import { Hono } from "hono";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

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
      <title>Deno Pro Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        body { font-family: sans-serif; background-color: #0f172a; color: #e2e8f0; }
        .btn { transition: all 0.2s; }
        .btn:active { transform: scale(0.95); }
      </style>
    </head>
    <body class="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 class="text-3xl font-extrabold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
        <i class="fa-solid fa-cloud-arrow-up"></i> Deno Stream & Downloader
      </h1>
      
      <!-- Upload Box -->
      <div class="bg-slate-800 p-6 rounded-xl shadow-xl border border-slate-700 mb-10">
        <label class="block mb-3 text-sm font-bold text-slate-300">Direct Video Link (MP4)</label>
        <div class="flex flex-col md:flex-row gap-3">
          <input type="text" id="urlInput" placeholder="https://site.com/video.mp4" class="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 focus:outline-none focus:border-blue-500 text-white">
          <button onclick="startUpload()" class="btn bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-bold text-white shadow-lg">
            <i class="fa-solid fa-upload"></i> Upload
          </button>
        </div>
        
        <!-- Progress Bar -->
        <div id="statusArea" class="mt-6 hidden transition-all">
          <div class="flex justify-between text-xs text-slate-400 mb-1">
            <span id="statusText">Starting...</span>
            <span id="percentText">0%</span>
          </div>
          <div class="w-full bg-slate-900 rounded-full h-3 overflow-hidden">
            <div id="progressBar" class="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
        </div>
      </div>

      <!-- History Section -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-slate-200"><i class="fa-solid fa-clock-rotate-left"></i> Recent Files</h2>
        <button onclick="loadHistory()" class="text-sm text-blue-400 hover:text-blue-300"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      
      <div id="historyList" class="space-y-4">
        <div class="text-center text-slate-500 py-10">Loading history...</div>
      </div>

      <script>
        async function loadHistory() {
          const res = await fetch('/api/history');
          const data = await res.json();
          const list = document.getElementById('historyList');
          list.innerHTML = '';
          
          if(data.length === 0) { list.innerHTML = '<div class="text-center text-slate-600">No files uploaded yet.</div>'; return; }

          data.forEach(item => {
            // Encode the URL for the download proxy
            const downloadUrl = '/api/force-download?url=' + encodeURIComponent(item.url) + '&name=' + encodeURIComponent(item.filename);

            list.innerHTML += \`
              <div class="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md flex flex-col md:flex-row gap-6">
                
                <!-- Left: Info & Actions -->
                <div class="flex-1 flex flex-col justify-between">
                  <div>
                    <h3 class="font-bold text-lg text-white mb-1 break-all line-clamp-2">\${item.filename}</h3>
                    <p class="text-xs text-slate-400 mb-4">\${new Date(item.ts).toLocaleString()}</p>
                  </div>

                  <!-- Two Main Buttons -->
                  <div class="flex flex-wrap gap-3 mt-2">
                    <!-- Stream / Copy Link -->
                    <div class="flex rounded-md shadow-sm" role="group">
                      <a href="\${item.url}" target="_blank" class="btn bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-l-md border-r border-emerald-800 flex items-center gap-2">
                         <i class="fa-solid fa-play"></i> Watch
                      </a>
                      <button onclick="copyToClip('\${item.url}')" class="btn bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-r-md" title="Copy Stream Link">
                        <i class="fa-regular fa-copy"></i>
                      </button>
                    </div>

                    <!-- Auto Download Link -->
                    <a href="\${downloadUrl}" class="btn bg-sky-600 hover:bg-sky-700 text-white text-sm px-4 py-2 rounded-md flex items-center gap-2 shadow-sm">
                      <i class="fa-solid fa-download"></i> Download
                    </a>
                  </div>
                </div>

                <!-- Right: Mini Player Preview -->
                <div class="md:w-64 bg-black rounded-lg overflow-hidden shrink-0 border border-slate-600 relative group">
                   <video controls preload="metadata" class="w-full h-full object-cover">
                      <source src="\${item.url}" type="video/mp4">
                   </video>
                </div>
              </div>
            \`;
          });
        }

        function copyToClip(text) {
          navigator.clipboard.writeText(text);
          alert("Stream Link Copied!");
        }

        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          if(!url) return alert("Please enter a link");

          const statusArea = document.getElementById('statusArea');
          const progressBar = document.getElementById('progressBar');
          const statusText = document.getElementById('statusText');
          const percentText = document.getElementById('percentText');
          
          statusArea.classList.remove('hidden');
          statusText.innerText = "Initializing...";
          progressBar.style.width = '0%';
          percentText.innerText = '0%';

          try {
            const startRes = await fetch('/api/upload', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ url })
            });
            const { jobId } = await startRes.json();

            const interval = setInterval(async () => {
              const pollRes = await fetch('/api/status/' + jobId);
              const pollData = await pollRes.json();

              if (pollData.status === 'processing') {
                const pct = Math.round((pollData.loaded / pollData.total) * 100) || 0;
                progressBar.style.width = pct + '%';
                percentText.innerText = pct + '%';
                statusText.innerText = \`Uploading... (\${(pollData.loaded/1024/1024).toFixed(1)} MB)\`;
              } else if (pollData.status === 'completed') {
                clearInterval(interval);
                progressBar.style.width = '100%';
                percentText.innerText = '100%';
                statusText.innerText = "Done!";
                setTimeout(() => {
                   statusArea.classList.add('hidden');
                   loadHistory();
                }, 1000);
              } else if (pollData.status === 'failed') {
                clearInterval(interval);
                progressBar.classList.remove('from-blue-500', 'to-purple-500');
                progressBar.classList.add('bg-red-600');
                statusText.innerText = "Error: " + pollData.error;
              }
            }, 1000);

          } catch (e) {
            alert("Error: " + e.message);
          }
        }

        loadHistory();
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

// --- API: Start Upload ---
app.post("/api/upload", async (c) => {
  const { url } = await c.req.json();
  const jobId = crypto.randomUUID();
  // Clean filename
  let filename = url.split('/').pop().split('?')[0];
  if (!filename.endsWith('.mp4')) filename += '.mp4';

  await kv.set(["jobs", jobId], { status: "processing", loaded: 0, total: 0 });
  
  // Start background upload
  runUploadTask(jobId, url, filename).catch(err => {
    console.error(err);
    kv.set(["jobs", jobId], { status: "failed", error: err.message });
  });

  return c.json({ jobId });
});

async function runUploadTask(jobId: string, url: string, filename: string) {
  try {
    const sourceRes = await fetch(url);
    if (!sourceRes.ok) throw new Error("Source fetch failed");
    const totalSize = Number(sourceRes.headers.get("content-length")) || 0;
    
    let loaded = 0;
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        loaded += chunk.length;
        // Update status every ~2MB
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
    await kv.set(["jobs", jobId], { status: "completed", url: r2Url });
    await kv.set(["history", Date.now()], { filename, url: r2Url, ts: Date.now() });
  } catch (err) {
    await kv.set(["jobs", jobId], { status: "failed", error: err.message });
  }
}

// --- API: Status & History ---
app.get("/api/status/:id", async (c) => {
  const result = await kv.get(["jobs", c.req.param("id")]);
  return c.json(result.value || { status: "unknown" });
});

app.get("/api/history", async (c) => {
  const entries = kv.list({ prefix: ["history"] }, { limit: 20, reverse: true });
  const history = [];
  for await (const entry of entries) history.push(entry.value);
  return c.json(history);
});

// --- API: Force Download Proxy ---
// This endpoint proxies the R2 file and adds "Content-Disposition: attachment"
app.get("/api/force-download", async (c) => {
  const fileUrl = c.req.query("url");
  const fileName = c.req.query("name") || "video.mp4";

  if (!fileUrl) return c.text("URL required", 400);

  // Fetch the file from R2
  const response = await fetch(fileUrl);
  
  // Create a new response that pipes the body but forces download headers
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "video/mp4",
      "Content-Disposition": `attachment; filename="${fileName}"`, // This forces the browser to download
    },
  });
});

Deno.serve(app.fetch);
