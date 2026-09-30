/** Full-screen menus: title, team pick, help, settings, pause and result. */
import { DIFFICULTY_NAMES, LENGTH_NAMES, type Settings } from "../game/settings";
import { CONFERENCE_NAMES, DIVISION_NAMES, LEAGUE_NAME, TEAMS, strength, type Team } from "../game/teams";
import type { Match } from "../sim/match";
import { periodLabel } from "./hud";

export interface MatchConfig {
  home: number;
  away: number;
  twoPlayers: boolean;
  shootoutOnly: boolean;
}

export interface Handlers {
  start(cfg: MatchConfig): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  settings(s: Settings): void;
}

type Kind = "quick" | "two" | "shootout";

const stars = (t: Team): string => {
  const n = Math.max(1, Math.min(5, Math.round((strength(t) - 64) / 5) + 1));
  return "★".repeat(n) + "☆".repeat(5 - n);
};

function card(t: Team, sel = false): string {
  return `<button class="card${sel ? " sel" : ""}" data-team="${t.id}"><i class="kit" style="--c1:${t.main};--c2:${t.accent}"></i><span><b>${t.name}</b><small>${t.city}</small><br><span class="stars">${stars(t)}</span></span></button>`;
}

function teamGrid(): string {
  let html = "";
  for (const conf of ["west", "east"] as const) {
    const divs = conf === "west" ? (["north", "central"] as const) : (["ural", "far"] as const);
    for (const d of divs) {
      html += `<h3>${CONFERENCE_NAMES[conf]} · ${DIVISION_NAMES[d]} дивизион</h3><div class="grid">`;
      for (const t of TEAMS.filter((x) => x.conference === conf && x.division === d)) html += card(t);
      html += "</div>";
    }
  }
  return html;
}

export class Screens {
  private root: HTMLElement;
  private pick: { kind: Kind; home: number | null } | null = null;

  constructor(
    private h: Handlers,
    private getSettings: () => Settings,
  ) {
    this.root = document.querySelector<HTMLElement>("#screen")!;
    this.root.addEventListener("click", (e) => this.onClick(e));
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    document.body.classList.remove("menu");
  }

  private set(html: string): void {
    this.root.innerHTML = html;
    this.root.classList.remove("hidden");
    this.root.scrollTop = 0;
    document.body.classList.add("menu");
  }

  title(): void {
    this.pick = null;
    this.set(`<div class="panel narrow">
      <h1 class="logo">Шайбу<span>!</span></h1>
      <p class="tag">Аркадный хоккей: ${LEAGUE_NAME}, 22 клуба, овертайм три на три и буллиты. Играйте против компьютера или вдвоём на одной клавиатуре.</p>
      <div class="btns col">
        <button class="b wide" data-act="quick">Быстрый матч <small>против компьютера</small></button>
        <button class="b wide sec" data-act="two">Вдвоём <small>одна клавиатура</small></button>
        <button class="b wide sec" data-act="shootout">Серия буллитов <small>тренировка</small></button>
        <button class="b wide sec" data-act="help">Как играть</button>
        <button class="b wide sec" data-act="settings">Настройки</button>
      </div>
    </div>`);
  }

  chooseTeam(kind: Kind, step: 1 | 2): void {
    const two = kind === "two";
    const title =
      step === 1
        ? two
          ? "Первый игрок: выберите клуб"
          : "Выберите ваш клуб"
        : two
          ? "Второй игрок: выберите клуб"
          : "Выберите соперника";
    const extra = step === 2 && !two ? `<button class="b sec" data-act="random">Случайный соперник</button>` : "";
    this.set(`<div class="panel">
      <div class="row"><h2 style="flex:1;margin:0">${title}</h2>${extra}<button class="b sec" data-act="menu">Назад</button></div>
      ${teamGrid()}
    </div>`);
  }

  help(): void {
    this.set(`<div class="panel narrow">
      <h2>Как играть</h2>
      <h3>Первый игрок</h3>
      <div class="kv"><kbd>W A S D</kbd><span>Движение (стрелки тоже, если играет один)</span>
        <kbd>F</kbd><span>Бросок: тап — кистевой, держите — щелчок</span>
        <kbd>Пробел</kbd><span>Пас. Без шайбы — смена игрока</span>
        <kbd>G</kbd><span>Отбор клюшкой, на скорости силовой приём</span>
        <kbd>Shift</kbd><span>Рывок (тратит силы)</span></div>
      <h3>Второй игрок</h3>
      <div class="kv"><kbd>← ↑ ↓ →</kbd><span>Движение</span>
        <kbd>.</kbd><span>Бросок</span><kbd>Enter</kbd><span>Пас, смена игрока</span>
        <kbd>/</kbd><span>Отбор</span><kbd>Правый Shift</kbd><span>Рывок</span></div>
      <h3>Приёмы</h3>
      <p class="tag" style="margin:4px 0">Нажмите бросок в момент, когда к вам летит пас, и будет бросок с первого касания. Броски целятся в дальний от вратаря угол, если смотрите на ворота. Пауза: Esc. Звук: M.</p>
      <p class="tag" style="margin:4px 0">На телефоне: джойстик слева, кнопки справа.</p>
      <div class="btns"><button class="b" data-act="menu">Понятно</button></div>
    </div>`);
  }

  settings(fromPause = false): void {
    const s = this.getSettings();
    const seg = (name: string, values: string[], cur: number) =>
      `<div class="seg" data-seg="${name}">${values.map((v, i) => `<button data-v="${i}" class="${i === cur ? "on" : ""}">${v}</button>`).join("")}</div>`;
    this.set(`<div class="panel narrow">
      <h2>Настройки</h2>
      <h3>Сложность компьютера</h3>${seg("difficulty", DIFFICULTY_NAMES, s.difficulty)}
      <h3>Длина периода</h3>${seg("length", LENGTH_NAMES, s.length)}
      <h3>Звук</h3>${seg("muted", ["Включён", "Выключен"], s.muted ? 1 : 0)}
      <h3>Качество графики</h3>${seg("quality", ["Авто", "Высокое", "Низкое"], ["auto", "high", "low"].indexOf(s.quality))}
      <div class="btns"><button class="b" data-act="${fromPause ? "pause" : "menu"}">Готово</button></div>
    </div>`);
  }

  pause(): void {
    this.set(`<div class="panel narrow">
      <h2>Пауза</h2>
      <div class="btns col">
        <button class="b wide" data-act="resume">Продолжить</button>
        <button class="b wide sec" data-act="restart">Начать матч заново</button>
        <button class="b wide sec" data-act="settings-pause">Настройки</button>
        <button class="b wide sec" data-act="help-pause">Управление</button>
        <button class="b wide sec" data-act="exit">Выйти в меню</button>
      </div>
    </div>`);
  }

  result(m: Match, teams: [Team, Team], nameOf: (id: number) => string): void {
    const by = m.decidedBy === "ot" ? "ОТ" : m.decidedBy === "so" ? "Б" : "";
    const winnerName = m.winner === null ? "" : teams[m.winner].name;
    const rows = m.goals
      .map((g) => {
        const min = Math.floor(g.at / 60);
        const clock = g.ot ? "ОТ" : `${Math.min(60, (g.period - 1) * 20 + min + 1)}'`;
        const assists = g.assists.length ? ` (${g.assists.map((a) => nameOf(a).replace(/^№\d+ /, "")).join(", ")})` : "";
        return `<li><span class="m">${clock}</span><b style="color:${teams[g.team].main === "#1c1c1c" || teams[g.team].main === "#242424" ? "#fff" : teams[g.team].main}">${teams[g.team].short}</span><span>${nameOf(g.scorer) || "—"}${assists}</span></li>`;
      })
      .join("");
    const so = m.so ? ` <small>по буллитам ${m.so.score[0]}:${m.so.score[1]}</small>` : "";
    this.set(`<div class="panel narrow">
      <h2 style="text-align:center">Матч окончен</h2>
      <div class="result-score"><span class="t">${teams[0].name}</span><span>${m.score[0]} : ${m.score[1]}${by ? ` <small>${by}</small>` : ""}</span><span class="t">${teams[1].name}</span></div>
      <p class="tag" style="text-align:center;margin:0">${winnerName ? `Победа: ${winnerName}` : ""}${so}</p>
      <h3>Статистика</h3>
      <table class="stat">
        <tr><td>${m.stats.onGoal[0]}</td><td>Броски в створ</td><td>${m.stats.onGoal[1]}</td></tr>
        <tr><td>${m.stats.shots[0]}</td><td>Всего бросков</td><td>${m.stats.shots[1]}</td></tr>
        <tr><td>${m.stats.hits[0]}</td><td>Силовые приёмы</td><td>${m.stats.hits[1]}</td></tr>
      </table>
      ${rows ? `<h3>Голы</h3><ul class="goals">${rows}</ul>` : ""}
      <div class="btns"><button class="b" data-act="again">Ещё раз</button><button class="b sec" data-act="exit">В меню</button></div>
    </div>`);
    void periodLabel;
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLElement>("[data-seg] button");
    if (seg) {
      const name = seg.parentElement!.dataset.seg!;
      const v = Number(seg.dataset.v);
      const s = { ...this.getSettings() };
      if (name === "difficulty") s.difficulty = v as 0 | 1 | 2;
      else if (name === "length") s.length = v as 0 | 1 | 2;
      else if (name === "muted") s.muted = v === 1;
      else if (name === "quality") s.quality = (["auto", "high", "low"] as const)[v];
      this.h.settings(s);
      seg.parentElement!.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === seg));
      return;
    }
    const cardEl = t.closest<HTMLElement>("[data-team]");
    if (cardEl && this.pick) {
      const id = Number(cardEl.dataset.team);
      this.onTeam(id);
      return;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    switch (act) {
      case "quick":
      case "two":
      case "shootout":
        this.pick = { kind: act, home: null };
        this.chooseTeam(act, 1);
        break;
      case "random": {
        const p = this.pick;
        if (!p || p.home === null) break;
        let a = Math.floor(Math.random() * TEAMS.length);
        if (a === p.home) a = (a + 1) % TEAMS.length;
        this.launch(p.kind, p.home, a);
        break;
      }
      case "help":
        this.help();
        break;
      case "help-pause":
        this.help();
        this.root.querySelector<HTMLElement>("[data-act=menu]")!.dataset.act = "pause";
        break;
      case "settings":
        this.settings(false);
        break;
      case "settings-pause":
        this.settings(true);
        break;
      case "menu":
        this.title();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.h.resume();
        break;
      case "restart":
        this.h.restart();
        break;
      case "exit":
        this.h.toMenu();
        this.title();
        break;
      case "again":
        this.h.restart();
        break;
    }
  }

  private onTeam(id: number): void {
    const p = this.pick!;
    if (p.home === null) {
      p.home = id;
      if (p.kind === "shootout") {
        // Pick the other side too so the shootout has two teams.
        this.chooseTeam("quick", 2);
      } else this.chooseTeam(p.kind, 2);
      return;
    }
    this.launch(p.kind, p.home, id === p.home ? (id + 1) % TEAMS.length : id);
  }

  private launch(kind: Kind, home: number, away: number): void {
    this.pick = null;
    this.h.start({ home, away, twoPlayers: kind === "two", shootoutOnly: kind === "shootout" });
  }
}
