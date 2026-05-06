(function () {
    var pathParts = window.location.pathname.split('/').filter(function (part) {
        return part;
    });
    var tenantId = pathParts[0];

    var socket = typeof connectSocket === 'function' ? connectSocket() : io({ query: { tenantId: tenantId } });

    if (tenantId && tenantId !== 'lower-third') {
        socket.emit('join', { tenantId: tenantId });
    }

    var lowerThird = document.getElementById('lowerThird');
    var songTitleEl = document.getElementById('songTitle');
    var singerNameEl = document.getElementById('singerName');

    function applyLowerThird(data) {
        if (!data) return;
        if (data.title !== undefined && data.title !== null) {
            songTitleEl.textContent = String(data.title).trim() || '—';
        }
        if (data.singer !== undefined && data.singer !== null) {
            singerNameEl.textContent = String(data.singer).trim() || '—';
        }
        if (data.visible !== undefined) {
            var vis = !!data.visible;
            lowerThird.setAttribute('data-visible', vis ? 'true' : 'false');
            lowerThird.setAttribute('aria-hidden', vis ? 'false' : 'true');
        }
    }

    socket.on('lowerThirdUpdate', applyLowerThird);

    socket.on('connect', function () {
        console.log('Lower third overlay connected');
    });

    socket.on('disconnect', function () {
        console.log('Lower third overlay disconnected');
    });
})();
