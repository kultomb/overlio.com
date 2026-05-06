// Utility function to get tenant ID from URL or localStorage
function getTenantId() {
    // First try to get from URL
    const pathParts = window.location.pathname.split('/').filter(part => part);
    let tenantId = pathParts[0];
    
    // If no tenantId in URL, try to get from localStorage (for main page overlays)
    if (!tenantId) {
        tenantId = localStorage.getItem('currentTenantId');
    }
    
    return tenantId;
}

// Utility function to get username from localStorage
function getUsername() {
    return localStorage.getItem('currentUsername');
}

// Utility function to check if user is authenticated
function isAuthenticated() {
    return localStorage.getItem('currentTenantId') && localStorage.getItem('currentUsername');
}

// Connect to Socket.IO with tenant ID
function connectSocket() {
    const tenantId = getTenantId();
    return io({ query: { tenantId } });
} 