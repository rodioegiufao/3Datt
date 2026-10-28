/** Screen overlays for the active clash; Marker provides the world-to-canvas projection. */
export function createClashResultsView({viewer, onNavigate, onShowAll, onIsolate, onExport, statusLabels = {}, onStatusChange}) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./clash-results-view.css', import.meta.url).href;
    document.head.append(stylesheet);
    const footer = document.createElement('nav');
    footer.className = 'clash-results-footer';
    footer.setAttribute('aria-label', 'Navegação das interferências');
    footer.hidden = true;
    footer.innerHTML = `<button data-step="-1" aria-label="Interferência anterior">‹ Anterior</button><span role="status" aria-live="polite"></span><button data-step="1" aria-label="Próxima interferência">Próxima ›</button><button data-isolate aria-pressed="false">Isolar</button><label class="clash-footer-status">Status <select data-status>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button data-all>Mostrar todas</button><button data-export>↓ Exportar BCF Viewpoint</button>`;
    const annotation = document.createElement('div');
    annotation.className = 'clash-world-note';
    annotation.hidden = true;
    annotation.innerHTML = '<button class="clash-world-pin" aria-label="Mostrar nota da interferência"></button><article class="clash-world-card"><strong></strong><p class="clash-note-a"></p><p class="clash-note-b"></p><small></small></article>';
    document.body.append(footer, annotation);
    footer.querySelectorAll('[data-step]').forEach(button => button.onclick = () => onNavigate(Number(button.dataset.step)));
    footer.querySelector('[data-all]').onclick = onShowAll;
    footer.querySelector('[data-isolate]').onclick = () => onIsolate?.();
    footer.querySelector('[data-status]').onchange = event => onStatusChange?.(event.target.value);
    footer.querySelector('[data-export]').onclick = onExport;
    const pin = annotation.querySelector('button');
    const card = annotation.querySelector('article');
    pin.onclick = () => { card.hidden = !card.hidden; pin.setAttribute('aria-expanded', String(!card.hidden)); };
    let marker = null;
    function position() {
        if (!marker || footer.hidden) { annotation.hidden = true; return; }
        const canvas = viewer.scene.canvas.canvas;
        const rect = canvas.getBoundingClientRect();
        const point = marker.canvasPos;
        // Markers behind the camera or outside the canvas must not leave floating notes.
        const view = marker.viewPos;
        if (!point || (view && view[2] >= 0) || point[0] < 0 || point[1] < 0 || point[0] > canvas.clientWidth || point[1] > canvas.clientHeight) {
            annotation.hidden = true;
            return;
        }
        annotation.hidden = false;
        const x = rect.left + point[0], y = rect.top + point[1];
        annotation.style.left = `${x}px`;
        annotation.style.top = `${y}px`;
        const width = Math.min(310, window.innerWidth - 32);
        card.style.width = `${width}px`;
        card.style.left = `${Math.max(8 - x, Math.min(28, window.innerWidth - width - 12 - x))}px`;
        card.style.top = `${Math.max(8 - y, Math.min(20, window.innerHeight - footer.offsetHeight - card.offsetHeight - 40 - y))}px`;
    }
    const tick = viewer.scene.on('tick', position);
    return {
        update(clash, index, count, nextMarker, mode = 'context') {
            marker = nextMarker;
            footer.hidden = !clash;
            if (!clash) { annotation.hidden = true; return; }
            const isolateButton = footer.querySelector('[data-isolate]');
            isolateButton.textContent = mode === 'isolate' ? 'Sair do isolamento' : 'Isolar';
            isolateButton.setAttribute('aria-pressed', String(mode === 'isolate'));
            isolateButton.classList.toggle('is-active', mode === 'isolate');
            footer.querySelector('[data-status]').value = clash.status || 'new';
            footer.querySelector('span').textContent = `Interferência ${index + 1} de ${count}`;
            footer.querySelectorAll('[data-step]').forEach(button => button.disabled = count < 2);
            pin.textContent = String(index + 1);
            pin.setAttribute('aria-expanded', 'true');
            card.hidden = false;
            card.querySelector('strong').textContent = `Interferência ${index + 1} • ${clash.mode === 'clearance' ? 'Proximidade / Folga' : 'Colisão física'}`;
            for (const [key, label] of [['A', 'a'], ['B', 'b']]) {
                const object = clash[`object${key}`];
                card.querySelector(`.clash-note-${label}`).textContent = `${key}: ${object.name || object.objectId} • ${object.type} | ${object.modelLabel || object.modelId} | ID: ${object.originalSystemId || object.objectId}`;
            }
            card.querySelector('small').textContent = `${clash.mode === 'clearance' ? 'Elementos dentro da distância mínima' : 'Elementos em colisão'} • Posição (m): ${clash.position.map(n => Number(n).toFixed(3)).join(', ')}`;
            position();
        },
        destroy() { viewer.scene.off(tick); footer.remove(); annotation.remove(); stylesheet.remove(); }
    };
}
