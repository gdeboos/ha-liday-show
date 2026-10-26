// The printable sign for outside the house: title, QR code with the visitors' link, opening hours.
import { signHours, visitorLink } from "./publicsettings.js";
import { contrast } from "../public/colours.js";

const $ = (id) => document.getElementById(id);

async function start() {
  $("print").addEventListener("click", () => print());
  let view;
  try {
    const res = await fetch("api/public", { cache: "no-store" });
    if (!res.ok) throw new Error(await res.text());
    view = await res.json();
  } catch (e) {
    $("problem").textContent = `Couldn't load the public page settings: ${e.message}`;
    $("problem").hidden = false;
    return;
  }
  const link = visitorLink(view, location.hostname);
  if (!link || link.includes("<")) {
    $("problem").textContent = "Set the Public address on the Public page tab first, so the code on the sign "
      + "takes people to your page.";
    $("problem").hidden = false;
    $("print").disabled = true;
    $("download").hidden = true;
    return;
  }
  const qr = `api/public/qr.svg?link=${encodeURIComponent(link)}`;
  const look = view.look || {};
  $("title").textContent = look.title || "🎄 Light show";
  // Your heading colour, if it reads well on white paper; otherwise black.
  const head = look.theme === "custom" ? look.colours?.head
    : { christmas: "#1b6b3a", frosty: "#0d47a1", halloween: "#6a1b9a" }[look.theme];
  $("title").style.color = head && contrast(head, "#ffffff") >= 4.5 ? head : "#111111";
  $("qr").src = qr;
  $("download").href = `${qr}&download=1`;
  const hours = signHours(view.hours);
  $("hours").textContent = hours;
  $("hours").hidden = !hours;
  $("message").textContent = look.sign_text || "";
  $("message").hidden = !look.sign_text;
  $("link").textContent = link;
  document.title = `${look.title || "Light show"}: sign`;
  $("sheet").hidden = false;
}

start();
