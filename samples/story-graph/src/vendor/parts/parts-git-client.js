// Adapted from https://xs927991.xsrv.jp/web-components/assets/js/parts-git-client.js

  const icon = (type) => type === "remote"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 17c6 0 2-9 8-9"/></svg>';

  export class GitClient {
    constructor(root, data, options = {}) {
      this.options = options; this.expanded = new Set();
      this.root = root;
      this.data = data;
      this.filtered = this.data;
      this.list = root.querySelector(".parts-git-client__list");
      this.svg = root.querySelector(".parts-git-client__svg");
      this.empty = root.querySelector(".parts-git-client__empty");
      this.search = root.querySelector("[data-parts-git-search]");
      this.detail = root.querySelector("[data-parts-git-detail]");
      this.syncButton = root.querySelector("[data-parts-git-sync]");
      this.selectedId = null;
      this.onSearch = this.onSearch.bind(this);
      this.onClick = this.onClick.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onSync = this.onSync.bind(this);
      this.resizeFrame = 0;
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeFrame) return;
        this.resizeFrame = requestAnimationFrame(() => {
          this.resizeFrame = 0;
          this.renderGraph();
        });
      });
      this.search?.addEventListener("input", this.onSearch);
      this.list?.addEventListener("click", this.onClick);
      this.list?.addEventListener("keydown", this.onKeydown);
      this.syncButton?.addEventListener("click", this.onSync);
      this.render();
      this.resizeObserver.observe(this.root);
    }

    laneClass(lane) { return `parts-git-lane-${Math.abs(Number(lane) || 0) % 6}`; }

    render() {
      this.root.classList.toggle("is-empty", !this.filtered.length);
      this.list.innerHTML = this.filtered.map((commit) => {
        const refs = (commit.refs || []).map((ref) => `<span class="parts-git-client__ref parts-git-client__ref--${["remote", "tag", "head"].includes(ref.type) ? ref.type : "head"}">${icon(ref.type)}<span class="parts-git-client__ref-label">${this.escape(ref.name)}</span></span>`).join("");
        return `<li><div class="parts-git-client__commit" data-parts-git-row="${commit.id}"><button class="version-circle" data-parts-git-commit="${commit.id}" aria-expanded="${this.expanded.has(commit.id)}" aria-controls="version-${commit.id}" aria-label="${this.escape(this.options.t('versionToggle'))}: ${this.escape(commit.message)}"></button><button class="version-summary" data-parts-git-commit="${commit.id}" aria-expanded="${this.expanded.has(commit.id)}"><span class="parts-git-client__commit-main"><span class="parts-git-client__refs">${refs}</span><span class="parts-git-client__message">${this.escape(commit.message)}</span><span class="parts-git-client__meta">${this.escape(commit.date)}</span></span></button><span class="parts-git-client__hash">${commit.id.slice(0, 7)}</span></div><div id="version-${commit.id}" class="version-detail" ${this.expanded.has(commit.id)?'':'hidden'}></div></li>`;

      }).join("");
      this.renderGraph();
      this.renderDetail();
    }

    renderGraph() {
      const rows = [...this.list.querySelectorAll(".parts-git-client__commit")];
      const listTop = this.list.getBoundingClientRect().top;
      const height = this.list.getBoundingClientRect().height;
      const graphWidth = this.svg.getBoundingClientRect().width || 128;
      const maximumLane = Math.max(1, ...this.filtered.map((commit) => commit.lane));
      const laneWidth = Math.min(24, (graphWidth - 36) / maximumLane);
      const positions = new Map(this.filtered.map((commit, index) => {
        const rect = rows[index].getBoundingClientRect();
        return [commit.id, { x: 18 + commit.lane * laneWidth, y: rect.top - listTop + rect.height / 2, commit }];
      }));
      const edges = [];
      this.filtered.forEach((commit) => {
        const from = positions.get(commit.id);
        (commit.parents || []).forEach((parentId) => {
          const to = positions.get(parentId);
          if (!to) return;
          const bend = Math.min(24, Math.abs(to.y - from.y) / 3);
          const d = from.x === to.x ? `M${from.x} ${from.y} V${to.y}` :
            `M${from.x} ${from.y} V${to.y - bend * 2} C${from.x} ${to.y - bend},${to.x} ${to.y - bend},${to.x} ${to.y}`;
          edges.push(`<path class="parts-git-client__edge ${this.laneClass(commit.lane)}" d="${d}"/>`);
        });
      });
      const nodes = this.filtered.map((commit, index) => {
        const point = positions.get(commit.id);
        const selected = commit.id === this.selectedId;
        const halo = selected ? `<circle class="parts-git-client__halo ${this.laneClass(commit.lane)}" cx="${point.x}" cy="${point.y}" r="9"/>` : "";
        return `${halo}<circle class="parts-git-client__node ${this.laneClass(commit.lane)}${index === 0 ? " is-head" : ""}${selected ? " is-selected" : ""}" cx="${point.x}" cy="${point.y}" r="4.5"/>`;
      });
      this.svg.setAttribute("height", String(height));
      // The host's generic icon rule fixes SVGs to 18px; the timeline needs its measured height.
      this.svg.style.height = `${height}px`;
      this.svg.setAttribute("viewBox", `0 0 ${graphWidth} ${Math.max(1, height)}`);
      this.svg.innerHTML = edges.join("") + nodes.join("");
    }

    renderDetail() {
      for (const id of this.expanded) {
        const target = this.list.querySelector(`#version-${CSS.escape(id)}`);
        const commit = this.data.find(item=>item.id===id);
        if(target && commit) this.options.detail(commit,target,()=>this.renderGraph());
      }
    }
    select(id, focus = false) {
      if(!this.data.some(commit=>commit.id===id))return;
      this.selectedId=id;
      if(!focus) this.expanded.has(id)?this.expanded.delete(id):this.expanded.add(id);
      this.render();
      this.list.querySelector(`[data-parts-git-commit="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    }
    destroy() {
      this.resizeObserver.disconnect(); cancelAnimationFrame(this.resizeFrame);
      this.search?.removeEventListener("input",this.onSearch);
      this.list?.removeEventListener("click",this.onClick);
      this.list?.removeEventListener("keydown",this.onKeydown);
      this.syncButton?.removeEventListener("click",this.onSync);
    }
    onSearch() {
      const query = this.search.value.trim().toLocaleLowerCase();
      this.filtered = query ? this.data.filter((commit) => [commit.id, commit.message, commit.author, ...(commit.refs || []).map((ref) => ref.name)].join(" ").toLocaleLowerCase().includes(query)) : this.data;
      if (!this.filtered.some((commit) => commit.id === this.selectedId)) this.selectedId = this.filtered[0]?.id;
      this.render();
    }

    onClick(event) {
      const button = event.target.closest("[data-parts-git-commit]");
      if (button) this.select(button.dataset.partsGitCommit);
    }

    onKeydown(event) {
      const button = event.target.closest("[data-parts-git-commit]");
      if (!button || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = [...this.list.querySelectorAll(".version-circle")];
      let index = buttons.indexOf(button);
      if (event.key === "ArrowUp") index -= 1;
      if (event.key === "ArrowDown") index += 1;
      if (event.key === "Home") index = 0;
      if (event.key === "End") index = buttons.length - 1;
      const target = buttons[Math.max(0, Math.min(buttons.length - 1, index))];
      if (!target) return;
      event.preventDefault();
      this.select(target.dataset.partsGitCommit, true);
      target.scrollIntoView({ block: "nearest" });
    }

    onSync() { this.options.refresh?.(); }

    escape(value = "") {
      return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
    }
  }
