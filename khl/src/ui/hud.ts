/** Scoreboard, banners, shootout tracker and mini rink. */
import { rosterFor } from "../game/roster";
import type { Kit, Team } from "../game/teams";
import type { Match } from "../sim/match";
import { CORNER, HX, HY } from "../sim/rink";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function periodLabel(m: Match): string {
  if (m.phase === "shootout" || (m.period === 5 && m.settings.mode === "regular")) return "Буллиты";
  if (m.period <= 3) return `${m.period}-й период`;
  if (m.settings.mode === "playoff") return `ОТ ${m.period - 3}`;
  return "Овертайм";
}

export class Hud {
  private root = $("#hud");
  private home = $<HTMLElement>("#scoreboard .team.home");
  private away = $<HTMLElement>("#scoreboard .team.away");
  private period = $("#period");
  private clock = $("#clock");
  private shots = $("#shots");
  private banner = $("#banner");
  private sub = $("#sub");
  private so = $("#shootout");
  private hintEl = $("#hint");
  private mini = $<HTMLCanvasElement>("#minimap");
  private pp = $("#pp");
  private bannerTimer = 0;
  private hintTimer = 0;
  private teams: [Team, Team] | null = null;
  private kits: [Kit, Kit] | null = null;

  show(teams: [Team, Team], kits: [Kit, Kit]): void {
    this.teams = teams;
    this.kits = kits;
    this.root.classList.remove("hidden");
    for (const [el, i] of [[this.home, 0], [this.away, 1]] as const) {
      el.querySelector<HTMLElement>(".tname")!.textContent = teams[i].short;
      el.querySelector<HTMLElement>(".badge")!.style.background = `linear-gradient(${kits[i].body} 70%, ${kits[i].trim} 70%)`;
      el.title = `${teams[i].city} · ${teams[i].name}`;
    }
    this.clearBanner();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  say(text: string, sub = "", seconds = 2.6): void {
    this.banner.textContent = text;
    this.sub.textContent = sub;
    this.banner.classList.add("show");
    this.sub.classList.toggle("show", sub !== "");
    this.bannerTimer = seconds;
  }

  clearBanner(): void {
    this.banner.classList.remove("show");
    this.sub.classList.remove("show");
    this.bannerTimer = 0;
  }

  hint(text: string, seconds = 4): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add("show");
    this.hintTimer = seconds;
  }

  /** Name of the skater with this id, e.g. "№27 Кузнецов". */
  playerName(m: Match, id: number): string {
    if (id < 0 || !this.teams) return "";
    const s = m.w.skaters[id];
    const p = rosterFor(this.teams[s.team].id)[s.role];
    return `№${p.number} ${p.name}`;
  }

  update(m: Match, dt: number): void {
    this.home.querySelector<HTMLElement>(".score")!.textContent = String(m.score[0]);
    this.away.querySelector<HTMLElement>(".score")!.textContent = String(m.score[1]);
    this.period.textContent = periodLabel(m);
    const shown = m.phase === "shootout" ? 0 : m.clock * m.timeScale;
    this.clock.textContent = m.phase === "shootout" ? "" : formatClock(shown);
    this.clock.classList.toggle("low", m.phase === "play" && shown <= 30 && m.period >= 3);
    this.shots.textContent = `Броски в створ ${m.stats.onGoal[0]} : ${m.stats.onGoal[1]}`;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.clearBanner();
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.remove("show");
    }
    this.updateShootout(m);
    this.updatePenalties(m);
    this.drawMini(m);
  }

  private updatePenalties(m: Match): void {
    if (m.penalties.length === 0 || !this.teams) {
      this.pp.classList.remove("show");
      return;
    }
    const html = m.penalties
      .map((p) => {
        const t = this.teams![p.team];
        return `<span><b>${t.short}</b> ${this.playerName(m, p.skater)} ${formatClock(p.left * m.timeScale)}</span>`;
      })
      .join("");
    if (this.pp.dataset.h !== html) {
      this.pp.dataset.h = html;
      this.pp.innerHTML = html;
    }
    this.pp.classList.add("show");
  }

  private updateShootout(m: Match): void {
    const so = m.so;
    if (!so) {
      this.so.classList.remove("show");
      return;
    }
    this.so.classList.add("show");
    const rows = [0, 1].map((t) => {
      const mine = so.attempts.filter((a) => a.team === t);
      const n = Math.max(3, mine.length);
      let html = "";
      for (let i = 0; i < n; i++) {
        const a = mine[i];
        html += `<i class="dot ${a && a.result !== "pending" ? a.result : ""}"></i>`;
      }
      return `<div class="row"><b>${this.teams?.[t as 0 | 1].short ?? ""}</b>${html}</div>`;
    });
    const html = rows.join("");
    if (this.so.dataset.h !== html) {
      this.so.dataset.h = html;
      this.so.innerHTML = html;
    }
  }

  private drawMini(m: Match): void {
    const c = this.mini;
    const ctx = c.getContext("2d")!;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    const k = Math.min((W - 16) / (HX * 2), (H - 16) / (HY * 2));
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(-HX + CORNER, -HY);
    ctx.lineTo(HX - CORNER, -HY);
    ctx.arc(HX - CORNER, -HY + CORNER, CORNER, -Math.PI / 2, 0);
    ctx.lineTo(HX, HY - CORNER);
    ctx.arc(HX - CORNER, HY - CORNER, CORNER, 0, Math.PI / 2);
    ctx.lineTo(-HX + CORNER, HY);
    ctx.arc(-HX + CORNER, HY - CORNER, CORNER, Math.PI / 2, Math.PI);
    ctx.lineTo(-HX, -HY + CORNER);
    ctx.arc(-HX + CORNER, -HY + CORNER, CORNER, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = "#dcecf7";
    ctx.fill();
    ctx.strokeStyle = "#6b7a96";
    ctx.lineWidth = 1.2 / k;
    ctx.stroke();
    ctx.fillStyle = "#c8323c";
    ctx.fillRect(-0.4, -HY, 0.8, HY * 2);
    ctx.fillStyle = "#2c63b8";
    ctx.fillRect(-7.14 - 0.4, -HY, 0.8, HY * 2);
    ctx.fillRect(7.14 - 0.4, -HY, 0.8, HY * 2);
    const kits = this.kits;
    for (const s of m.w.skaters) {
      if (!s.active || !kits) continue;
      ctx.fillStyle = kits[s.team].body;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, s.role === "G" ? 1.4 : 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.w.human[s.team] && m.w.controlled[s.team] === s.id) {
        ctx.strokeStyle = s.team === 0 ? "#ffd32a" : "#48dbfb";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, 2.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(m.w.puck.pos.x, m.w.puck.pos.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
