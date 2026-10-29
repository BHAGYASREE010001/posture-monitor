/**
 * auth.js - handles the Log In and Sign Up forms (login.html, register.html).
 */
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const msg = document.getElementById("msg");

function showMessage(text) {
  msg.textContent = text;
  msg.classList.toggle("hidden", !text);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("");
  const { ok, data } = await post("/api/login", {
    username: document.getElementById("username").value.trim(),
    password: document.getElementById("password").value,
  });
  if (!ok) return showMessage(data.message || "Log in failed.");
  window.location.href = "/";
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("");
  const password = document.getElementById("password").value;
  if (password !== document.getElementById("confirm").value) {
    return showMessage("Passwords do not match.");
  }
  const { ok, data } = await post("/api/register", {
    username: document.getElementById("username").value.trim(),
    password,
  });
  if (!ok) return showMessage(data.message || "Sign up failed.");
  window.location.href = "/login";
});