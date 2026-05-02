(function () {
  // Configure staging Firebase project here.
  // These values are public client config values from Firebase project settings.
  // Leave firebaseConfig as null to disable staging switch.
  window.ADMIN_ENV_CONFIGS = {
    production: {
      label: 'Production'
    },
    staging: {
      label: 'Staging',
      firebaseConfig: {
        apiKey: 'AIzaSyAvPD3BvuLvhE6wszYHH0IZz8mhOaqsED8',
        authDomain: 'catan-liga-staging.firebaseapp.com',
        projectId: 'catan-liga-staging',
        storageBucket: 'catan-liga-staging.firebasestorage.app',
        messagingSenderId: '129238166424',
        appId: '1:129238166424:web:4f28227fa2970a2b3759ed',
        measurementId: 'G-PRKZ13J2TW'
      }
    }
  };
})();
