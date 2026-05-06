// Connect to Socket.IO server with tenant ID
const socket = connectSocket();

// DOM elements
const leftTeamName = document.getElementById('leftTeamName');
const rightTeamName = document.getElementById('rightTeamName');
const leftScore = document.getElementById('leftScore');
const rightScore = document.getElementById('rightScore');
const leftTeamColorBar = document.getElementById('leftTeamColorBar');
const rightTeamColorBar = document.getElementById('rightTeamColorBar');
const matchTime = document.getElementById('matchTime');
const addedTimeRow = document.getElementById('addedTimeRow');
const addedTimeClock = document.getElementById('addedTimeClock');
const addedTimeValue = document.getElementById('addedTimeValue');

// Initialize with default values
let currentScores = { left: 0, right: 0 };
let currentTeams = { left: 'Home', right: 'Away' };
let currentColors = { left: '#ff0000', right: '#0066cc', left2: '#ffffff', right2: '#ffffff' };
let currentTime = '00:00';

// Socket event listeners
socket.on('connect', () => {
    console.log('Scoreboard connected to server');
    socket.emit('requestInitialData');
});

socket.on('disconnect', () => console.log('Scoreboard disconnected from server'));
socket.on('connect_error', (error) => console.error('Scoreboard connection error:', error));

// Debug: Log all socket events
socket.onAny((eventName, ...args) => {
    console.log(`Socket event received: ${eventName}`, args);
});
socket.on('scoreUpdate', (data) => updateScores(data.leftScore, data.rightScore));
socket.on('teamUpdate', (data) => updateTeams(data.leftTeam, data.rightTeam));
socket.on('colorUpdate', (data) => updateColors(data.leftColor, data.rightColor, data.leftColor2, data.rightColor2));
socket.on('timeUpdate', (data) => {
    updateTime(data.time);
    // Chỉ hiển thị bù giờ khi thực sự đang chạy bù giờ (có addedTimeClock)
    if (data.addedTimeClock) {
        // Hiển thị đồng hồ đếm ngược
        addedTimeClock.textContent = data.addedTimeClock;
        // Chỉ hiển thị số phút bù giờ nếu có bù giờ thực sự (không phải +0 hoặc 0)
        if (data.addedTime && data.addedTime !== '+0' && data.addedTime !== '0') {
            addedTimeValue.textContent = data.addedTime;
            addedTimeValue.style.display = 'flex';
        } else {
            addedTimeValue.style.display = 'none';
        }
        addedTimeRow.style.display = 'flex';
    } else {
        // Không hiển thị bù giờ khi chưa hết hiệp
        addedTimeRow.style.display = 'none';
    }
});

// Scoreboard show/hide event listeners
socket.on('showScoreboard', () => {
    console.log('Showing scoreboard');
    const scoreboardBar = document.querySelector('.scoreboard-bar');
    if (scoreboardBar) {
        scoreboardBar.style.display = 'flex';
        scoreboardBar.style.animation = 'fadeIn 0.5s ease-in-out';
    }
});

socket.on('hideScoreboard', () => {
    console.log('Hiding scoreboard');
    const scoreboardBar = document.querySelector('.scoreboard-bar');
    if (scoreboardBar) {
        scoreboardBar.style.animation = 'fadeOut 0.5s ease-in-out';
        setTimeout(() => {
            scoreboardBar.style.display = 'none';
        }, 500);
    }
});

// Initialize scoreboard as hidden by default
document.addEventListener('DOMContentLoaded', () => {
    const scoreboardBar = document.querySelector('.scoreboard-bar');
    if (scoreboardBar) {
        scoreboardBar.style.display = 'none';
        console.log('Scoreboard initialized as hidden');
    }
});

// Update functions
const updateScores = (left, right) => {
    if (left !== currentScores.left) {
        leftScore.textContent = left;
        leftScore.classList.add('updated');
        setTimeout(() => leftScore.classList.remove('updated'), 500);
        currentScores.left = left;
    }
    if (right !== currentScores.right) {
        rightScore.textContent = right;
        rightScore.classList.add('updated');
        setTimeout(() => rightScore.classList.remove('updated'), 500);
        currentScores.right = right;
    }
};

const updateTeams = (left, right) => {
    if (left !== currentTeams.left) {
        leftTeamName.textContent = left;
        currentTeams.left = left;
    }
    if (right !== currentTeams.right) {
        rightTeamName.textContent = right;
        currentTeams.right = right;
    }
};

const updateColors = (left, right, left2, right2) => {
    if (left !== currentColors.left || left2 !== currentColors.left2) {
        const leftBar = document.getElementById('leftTeamColorBar');
        leftBar.innerHTML = '';
        leftBar.style.display = 'flex';
        leftBar.style.flexDirection = 'column';
        leftBar.style.width = '9px';
        leftBar.style.height = '38px';
        const topDiv = document.createElement('div');
        topDiv.style.background = left || '#ff0000';
        topDiv.style.height = '50%';
        topDiv.style.width = '100%';
        const botDiv = document.createElement('div');
        botDiv.style.background = left2 || '#ffffff';
        botDiv.style.height = '50%';
        botDiv.style.width = '100%';
        leftBar.appendChild(topDiv);
        leftBar.appendChild(botDiv);
        currentColors.left = left;
        currentColors.left2 = left2;
    }
    if (right !== currentColors.right || right2 !== currentColors.right2) {
        const rightBar = document.getElementById('rightTeamColorBar');
        rightBar.innerHTML = '';
        rightBar.style.display = 'flex';
        rightBar.style.flexDirection = 'column';
        rightBar.style.width = '9px';
        rightBar.style.height = '38px';
        const topDiv = document.createElement('div');
        topDiv.style.background = right || '#0066cc';
        topDiv.style.height = '50%';
        topDiv.style.width = '100%';
        const botDiv = document.createElement('div');
        botDiv.style.background = right2 || '#ffffff';
        botDiv.style.height = '50%';
        botDiv.style.width = '100%';
        rightBar.appendChild(topDiv);
        rightBar.appendChild(botDiv);
        currentColors.right = right;
        currentColors.right2 = right2;
    }
};

const updateTime = (time) => {
    if (time !== currentTime) {
        matchTime.textContent = time;
        currentTime = time;
    }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    leftTeamName.textContent = currentTeams.left;
    rightTeamName.textContent = currentTeams.right;
    leftScore.textContent = currentScores.left;
    rightScore.textContent = currentScores.right;
    matchTime.textContent = currentTime;
    updateColors(currentColors.left, currentColors.right, currentColors.left2, currentColors.right2);
}); 