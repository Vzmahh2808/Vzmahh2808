/** Full-screen menus: title, team pick, help, settings, pause and result. */
import { DIFFICULTY_NAMES, LENGTH_NAMES, type Settings } from "../game/settings";
import {
  ROUND_NAMES,
  SEASON_LENGTHS,
  compareRows,
  conferenceTable,
  currentSeries,
  seriesGameNumber,
  seriesHome,
  standings,
  userFixture,
  userOutcome,
  type Season,
  type Series,
} from "../game/league";
import { CONFERENCE_NAMES, CUP_NAME, DIVISION_NAMES, LEAGUE_NAME, TEAMS, strength, teamById, type Team } from "../game/teams";
import type { Match } from "../sim/match";
import { periodLabel } from "./hud";

export interface MatchConfig {
  home: number;
  away: number;
  twoPlayers: boolean;
  shootoutOnly: boolean;
  /** Set for championship games: the result is recorded in the season. */
  league?: { mode: "regular" | "playoff"; userIsHome: boolean };
}

export interface Handlers {
  start(cfg: MatchConfig): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  settings(s: Settings): void;
  /** Championship. */
  leagueOpen(): void;
  leagueNew(user: number, games: 21 | 42 | 63): void;
  leaguePlay(): void;
  leagueSim(kind: "match" | "days" | "phase" | "season"): void;
  leagueContinue(): void;
  leagueBoost(): void;
  leagueDiscard(): void;
}

type Kind = "quick" | "two" | "shootout" | "league";

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
  hasSeason = false;
  /** Rewarded boost for the next match: not offered, offered, or already earned. */
  boost: "none" | "available" | "active" = "none";
  private tab: "table" | "games" | "playoffs" = "table";
  private season: Season | null = null;

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
        <button class="b wide" data-act="league">Чемпионат <small>${this.hasSeason ? "продолжить сезон" : "сезон и плей-офф"}</small></button>
        <button class="b wide sec" data-act="quick">Быстрый матч <small>против компьютера</small></button>
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
      kind === "league"
        ? "Выберите клуб для сезона"
        : step === 1
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
      <h3>Штрафы (две минуты)</h3>${seg("penalties", ["Включены", "Выключены"], s.penalties ? 0 : 1)}
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

  result(m: Match, teams: [Team, Team], nameOf: (id: number) => string, league = false): void {
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
      <div class="btns">${league ? `<button class="b" data-act="league-continue">Продолжить чемпионат</button>` : `<button class="b" data-act="again">Ещё раз</button><button class="b sec" data-act="exit">В меню</button>`}</div>
    </div>`);
    void periodLabel;
  }


  // ------------------------------------------------------------ championship

  leagueMenu(): void {
    this.pick = null;
    this.set(`<div class="panel narrow">
      <h2>Чемпионат</h2>
      <p class="tag">${LEAGUE_NAME}: 22 клуба, регулярный сезон по кругу и плей-офф на 16 команд до четырёх побед. Разыграйте ${CUP_NAME}.</p>
      <div class="btns col">
        ${this.hasSeason ? `<button class="b wide" data-act="league-open">Продолжить сезон</button>` : ""}
        <button class="b wide ${this.hasSeason ? "sec" : ""}" data-act="league-new">Новый сезон</button>
        <button class="b wide sec" data-act="menu">Назад</button>
      </div>
      ${this.hasSeason ? `<p class="tag" style="margin-top:12px;font-size:12px">Новый сезон заменит сохранённый.</p>` : ""}
    </div>`);
  }

  private leagueLength(user: number): void {
    const t = teamById(user);
    this.set(`<div class="panel narrow">
      <h2>${t.name}</h2>
      <p class="tag">${t.city}. Сколько матчей сыграть в регулярном чемпионате? В плей-офф выходят восемь лучших клубов каждой конференции.</p>
      <div class="btns col">
        ${SEASON_LENGTHS.map((l) => `<button class="b wide sec" data-len="${l.games}" data-user="${user}">${l.name}</button>`).join("")}
        <button class="b wide sec" data-act="league-new">Другой клуб</button>
      </div>
    </div>`);
  }

  private tableHtml(season: Season, conf: "west" | "east"): string {
    const rows = conferenceTable(standings(season), conf);
    const body = rows
      .map((r, i) => {
        const t = teamById(r.id);
        return `<tr class="${r.id === season.user ? "me" : ""}${i === 7 ? " cut" : ""}"><td>${i + 1}</td><td class="nm"><i class="kit sm" style="--c1:${t.main};--c2:${t.accent}"></i>${t.name}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.otl}</td><td>${r.l}</td><td>${r.gf}-${r.ga}</td><td><b>${r.pts}</b></td></tr>`;
      })
      .join("");
    return `<h3>${CONFERENCE_NAMES[conf]}</h3><table class="tbl"><tr><th></th><th></th><th>И</th><th>В</th><th>ПО</th><th>П</th><th>Ш</th><th>О</th></tr>${body}</table>`;
  }

  private gamesHtml(season: Season): string {
    const mine = season.fixtures.filter((f) => f.home === season.user || f.away === season.user);
    const rows = mine
      .map((f) => {
        const home = f.home === season.user;
        const opp = teamById(home ? f.away : f.home);
        let res = "";
        let cls = "";
        if (f.result) {
          const userGoals = home ? f.result.hg : f.result.ag;
          const oppGoals = home ? f.result.ag : f.result.hg;
          res = `${userGoals}:${oppGoals}${f.result.by === "ot" ? " ОТ" : f.result.by === "so" ? " Б" : ""}`;
          cls = userGoals > oppGoals ? "win" : f.result.by === "reg" ? "loss" : "otl";
        }
        return `<tr class="${f.day === season.day && !f.result ? "next" : ""}"><td>${f.day + 1}</td><td>${home ? "Дома" : "В гостях"}</td><td class="nm"><i class="kit sm" style="--c1:${opp.main};--c2:${opp.accent}"></i>${opp.name}</td><td class="${cls}">${res || "—"}</td></tr>`;
      })
      .join("");
    return `<table class="tbl"><tr><th>День</th><th></th><th></th><th>Счёт</th></tr>${rows}</table>`;
  }

  private seriesLine(season: Season, x: Series): string {
    const hi = teamById(x.hi);
    const lo = teamById(x.lo);
    const mine = x.hi === season.user || x.lo === season.user;
    const w = (id: number, name: string) => (x.winner === id ? `<b>${name}</b>` : name);
    return `<li class="${mine ? "me" : ""}"><span>${w(x.hi, hi.name)}</span><span class="sc">${x.hiWins}–${x.loWins}</span><span>${w(x.lo, lo.name)}</span></li>`;
  }

  private playoffsHtml(season: Season): string {
    const po = season.playoffs;
    if (!po) {
      const rows = standings(season);
      const list = (conf: "west" | "east") =>
        conferenceTable(rows, conf)
          .slice(0, 8)
          .map((r) => teamById(r.id).short)
          .join(" · ");
      return `<p class="tag">Плей-офф начнётся после регулярного чемпионата. Сейчас в нём были бы:</p><p class="tag"><b>Запад:</b> ${list("west")}<br><b>Восток:</b> ${list("east")}</p>`;
    }
    let html = "";
    const rounds = new Map<number, Series[]>();
    for (const x of [...po.history, ...po.series]) rounds.set(x.round, [...(rounds.get(x.round) ?? []), x]);
    for (const [round, list] of [...rounds.entries()].reverse()) {
      html += `<h3>${ROUND_NAMES[round as 1 | 2 | 3 | 4]}</h3><ul class="series">${list.map((x) => this.seriesLine(season, x)).join("")}</ul>`;
    }
    if (po.champion !== null) html = `<p class="champ">Чемпион: ${teamById(po.champion).name}</p>` + html;
    return html;
  }

  private boostButton(): string {
    if (this.boost === "active") return `<span class="tag" style="align-self:center;margin:0">Состав усилен на следующий матч</span>`;
    if (this.boost === "available") return `<button class="b sec" data-act="league-boost">Усилить состав (реклама)</button>`;
    return "";
  }

  hub(season: Season): void {
    this.season = season;
    const me = teamById(season.user);
    const rows = standings(season);
    const place = rows.findIndex((r) => r.id === season.user) + 1;
    const conf = conferenceTable(rows, me.conference);
    const confPlace = conf.findIndex((r) => r.id === season.user) + 1;
    const out = userOutcome(season);
    let head = "";
    let card = "";
    let buttons = "";
    if (season.phase === "regular") {
      head = `Регулярный чемпионат · день ${season.day + 1} из ${season.games}`;
      const f = userFixture(season);
      if (f) {
        const home = f.home === season.user;
        const opp = teamById(home ? f.away : f.home);
        card = `<div class="next"><span class="lbl">${home ? "Дома" : "В гостях"}</span><i class="kit" style="--c1:${opp.main};--c2:${opp.accent}"></i><b>${opp.name}</b><small>${opp.city} · ${"★".repeat(Math.max(1, Math.min(5, Math.round((strength(opp) - 64) / 5) + 1)))}</small></div>`;
        buttons = `<button class="b" data-act="league-play">Играть матч</button><button class="b sec" data-act="league-sim-match">Симулировать матч</button>${this.boostButton()}`;
      } else {
        card = `<div class="next"><b>В этот день ваш клуб не играет</b></div>`;
        buttons = `<button class="b sec" data-act="league-sim-match">Следующий день</button>`;
      }
      buttons += `<button class="b sec" data-act="league-sim-days">Пропустить 5 дней</button><button class="b sec" data-act="league-sim-phase">До конца регулярки</button>`;
    } else if (season.phase === "playoff") {
      const s = currentSeries(season, season.user);
      const round = season.playoffs!.round;
      head = `Плей-офф · ${ROUND_NAMES[round]}`;
      if (s) {
        const opp = teamById(s.hi === season.user ? s.lo : s.hi);
        const home = seriesHome(s) === season.user;
        const mineW = s.hi === season.user ? s.hiWins : s.loWins;
        const oppW = s.hi === season.user ? s.loWins : s.hiWins;
        card = `<div class="next"><span class="lbl">Игра ${seriesGameNumber(s)} · ${home ? "дома" : "в гостях"}</span><i class="kit" style="--c1:${opp.main};--c2:${opp.accent}"></i><b>${opp.name}</b><small>Серия ${mineW}–${oppW}, до четырёх побед</small></div>`;
        buttons = `<button class="b" data-act="league-play">Играть матч</button><button class="b sec" data-act="league-sim-match">Симулировать матч</button>${this.boostButton()}`;
      } else {
        card = `<div class="next"><b>${out.kind === "missed" ? "Ваш клуб не попал в плей-офф" : out.kind === "eliminated" ? `Ваш клуб выбыл: ${ROUND_NAMES[out.round!]}` : "Ждём соперников"}</b></div>`;
        buttons = `<button class="b sec" data-act="league-sim-match">Следующий день</button>`;
      }
      buttons += `<button class="b sec" data-act="league-sim-phase">До конца плей-офф</button>`;
    } else {
      head = "Сезон завершён";
      const champ = teamById(season.playoffs!.champion!);
      card = `<div class="next champ"><span class="lbl">${CUP_NAME}</span><i class="kit" style="--c1:${champ.main};--c2:${champ.accent}"></i><b>${champ.name}</b><small>${out.kind === "champion" ? "Это ваш клуб!" : out.kind === "missed" ? "Ваш клуб не попал в плей-офф" : `Ваш клуб выбыл: ${ROUND_NAMES[out.round!]}`}</small></div>`;
      buttons = `<button class="b" data-act="league-new">Новый сезон</button>`;
    }
    const tabs: [string, string][] = [["table", "Таблица"], ["games", "Ваши матчи"], ["playoffs", "Плей-офф"]];
    const body = this.tab === "table" ? this.tableHtml(season, "west") + this.tableHtml(season, "east") : this.tab === "games" ? this.gamesHtml(season) : this.playoffsHtml(season);
    this.set(`<div class="panel">
      <div class="row"><i class="kit" style="--c1:${me.main};--c2:${me.accent}"></i><div style="flex:1"><h2 style="margin:0">${me.name}</h2><div class="tag" style="margin:0">${head}${season.phase === "regular" ? ` · ${confPlace}-е место в конференции, ${place}-е в лиге` : ""}</div></div><button class="b sec" data-act="menu">Меню</button></div>
      ${card}
      <div class="btns">${buttons}</div>
      <div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="tabbody">${body}</div>
    </div>`);
    void compareRows;
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
      else if (name === "penalties") s.penalties = v === 0;
      else if (name === "quality") s.quality = (["auto", "high", "low"] as const)[v];
      this.h.settings(s);
      seg.parentElement!.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === seg));
      return;
    }
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab && this.season) {
      this.tab = tab.dataset.tab as "table" | "games" | "playoffs";
      this.hub(this.season);
      return;
    }
    const len = t.closest<HTMLElement>("[data-len]");
    if (len) {
      this.h.leagueNew(Number(len.dataset.user), Number(len.dataset.len) as 21 | 42 | 63);
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
      case "league":
        this.leagueMenu();
        break;
      case "league-open":
        this.h.leagueOpen();
        break;
      case "league-new":
        this.pick = { kind: "league", home: null };
        this.chooseTeam("league", 1);
        break;
      case "league-play":
        this.h.leaguePlay();
        break;
      case "league-sim-match":
        this.h.leagueSim("match");
        break;
      case "league-sim-days":
        this.h.leagueSim("days");
        break;
      case "league-sim-phase":
        this.h.leagueSim("phase");
        break;
      case "league-continue":
        this.h.leagueContinue();
        break;
      case "league-boost":
        this.h.leagueBoost();
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
    if (p.kind === "league") {
      this.pick = null;
      this.leagueLength(id);
      return;
    }
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
