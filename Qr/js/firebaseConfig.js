const firebaseConfig = {
    apiKey:           "AIzaSyAYhXnfm9e3y5gQVUs7Viu_JkLBvE3NfzI",
    authDomain:       "fromstrangerssocial.firebaseapp.com",
    projectId:        "fromstrangerssocial",
    storageBucket:    "fromstrangerssocial.firebasestorage.app",
    messagingSenderId: "233615930576",
    appId:            "1:233615930576:web:873500efe161e8b5649ad5"
  };
  
// 2) If in a browser, attach to window
if (typeof window !== 'undefined') {
  window.firebaseConfig = firebaseConfig;
}

// 3) If in Node (CommonJS), export it
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
}