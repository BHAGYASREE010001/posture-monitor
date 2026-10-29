/**
 * history.js - loads the logged-in user's posture history (history.html).
 */
const $ = (id) => document.getElementById(id);

async function api(url, body) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function load() {
  const me = await api("/api/me");
  $("username").textContent = me.data.username;

  const { data } = await api("/api/history");
  $("total").textContent = data.summary.total;
  $("good").textContent = `${data.summary.good_pct}%`;
  $("bad").textContent = `${data.summary.bad_pct}%`;

  const rows = $("rows");
  rows.replaceChildren();
  for (const r of data.records) {
    const tr = document.createElement("tr");
    const time = document.createElement("td");
    time.textContent = r.timestamp.replace("T", " ");
    const status = document.createElement("td");
    status.textContent = r.label.toUpperCase();
    status.className = r.label === "good" ? "good-text" : "bad-text";
    const conf = document.createElement("td");
    conf.textContent = `${Math.round(r.confidence * 100)}%`;
    tr.append(time, status, conf);
    rows.append(tr);
  }
  $("empty").classList.toggle("hidden", data.records.length > 0);
}

$("logout").addEventListener("click", async () => {
  await api("/api/logout", {});
  window.location.href = "/login";
});

load().catch(() => {});