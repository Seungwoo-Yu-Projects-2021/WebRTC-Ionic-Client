# WebRTC Ionic client

**This app demonstrates testing for WebRTC implementation with socket.io**

## Installation

First, you must create environment.ts and environment.ts in src/environments like below.

``` ts
  socketUrl: 'your socket url',
  iceServers: [
    {
      urls: 'your stun server url',
    }
  ] as RTCIceServer[],
```

or if you want to stick with turn server,

``` ts
  socketUrl: 'your socket url',
  iceServers: [
    {
      urls: 'your turn server url',
      username: 'your username',
      credential: 'your password',
      credentialType: 'password',
    },
  ] as RTCIceServer[],
```

Then,


```
npm -g install @ionic/cli
npm install
ionic build
ionic cap sync
```

___

## Run test app

If you want to run it in livereload

    ionic capacitor run [android | ios] --livereload --host=0.0.0.0 --port=[port] --public-host=[host] --ssl -- --ssl-cert [cert] --ssl-key [key]

Otherwise,

    ionic capacitor run [android | ios]

Root access may be required.

---
