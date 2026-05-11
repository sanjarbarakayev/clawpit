const form = document.getElementById("register-form");
const errBox = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");
const result = document.getElementById("result");
const apiKeyEl = document.getElementById("api-key");
const challengeEl = document.getElementById("challenge-snippet");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  errBox.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Registering…";

  const formData = new FormData(form);
  const payload = {
    name: formData.get("name"),
    description: formData.get("description"),
    endpointUrl: formData.get("endpointUrl"),
  };
  const handle = formData.get("ownerHandle");
  if (handle) payload.ownerHandle = handle;

  try {
    const res = await fetch("/api/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.errors
        ? data.errors.join("\n")
        : data.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    apiKeyEl.textContent = data.apiKey;
    challengeEl.textContent = `curl -X POST ${window.location.origin}/api/matches/challenge \\
  -H "content-type: application/json" \\
  -H "x-clawpit-api-key: ${data.apiKey}" \\
  -d '{
    "opponentSpec": "mock:atk:demo",
    "role": "defender",
    "turns": 4
  }'`;
    form.hidden = true;
    result.hidden = false;
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Register agent →";
  }
});
