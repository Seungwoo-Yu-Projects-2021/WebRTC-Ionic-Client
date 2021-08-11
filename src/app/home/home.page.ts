import { Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import {AndroidPermissions} from "@ionic-native/android-permissions/ngx";
import {Platform} from "@ionic/angular";
import {App} from "@capacitor/app";
import * as DetectRTC from "detectrtc";
import {RTCNoAvailableCameraError, RTCNoAvailableMicrophoneError, RTCNotSupportedError} from "./home.page.error";
import {Diagnostic} from "@ionic-native/diagnostic/ngx";
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

interface Offer {
  sdp: RTCSessionDescription,
  senderId: string,
  receiverId: string,
}

interface Answer {
  sdp: RTCSessionDescription,
  senderId: string,
  receiverId: string,
}

interface Candidate {
  candidate: RTCIceCandidateInit,
  senderId: string,
  receiverId: string,
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('localVideo', { read: ElementRef }) localVideo: ElementRef<HTMLVideoElement>
  @ViewChildren('remoteVideo', { read: ElementRef }) remoteVideo: QueryList<ElementRef<HTMLVideoElement>>

  private ioConnection?: Socket;
  private peerConnectionMap = new Map<string, RTCPeerConnection>();
  private localUserStreamData?: MediaStream;
  targetUserStreamDataMap = new Map<string, MediaStream>();

  constructor(
    private platform: Platform,
    private diagnostic: Diagnostic,
    private androidPermissions: AndroidPermissions,
  ) {}

  async ngOnInit() {
    if (this.platform.is('android')) {
      if (!(await this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.READ_EXTERNAL_STORAGE))?.hasPermission) {
        if (!(await this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.READ_EXTERNAL_STORAGE))?.hasPermission) {
          App.exitApp();
          return;
        }
      }
      if (!(await this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.CAMERA))?.hasPermission) {
        if (!(await this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.CAMERA))?.hasPermission) {
          App.exitApp();
          return;
        }
      }
      if (!(await this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.RECORD_AUDIO))?.hasPermission) {
        if (!(await this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.RECORD_AUDIO))?.hasPermission) {
          App.exitApp();
          return;
        }
      }
    }

    try {
      await this.checkRTCAvailability();

      /**
       * Create listeners as soon as socket.io instance is created.
       */
      this.ioConnection = io(environment.socketUrl);

      /**
       * Event when user created room
       */
      this.ioConnection.on('on-create', (roomId) => {
        console.log('on-create', roomId);
      });

      /**
       * Event when user *tried* joining to specific room
       * @param userIds Optional. indicates user ids or undefined if tried joining to empty room
       */
      this.ioConnection.on('on-join', (userIds?: string[]) => {
        console.log('on-join', userIds);

        if (userIds == null) {
          this.ioConnection.emit('create-room', 1);
        } else {
          /**
           * Since user just joined to room, user must send offers to the others for data transmission
           */
          this.sendOffers(userIds);
        }
      });

      /**
       * Event when user got offer from another user
       */
      this.ioConnection.on('on-received-offer', async (offer: Offer) => {
        console.log('on-received-offer', offer);

        /**
         * Create peer connection for offer sender and allocate data tracks
         */
        const peerConnection = this.getOrCreatePeerConnection(offer.senderId);
        /**
         * Be aware of data track allocation due to data won't be transferred without any errors if
         * setLocalDescription or setRemoteDescription is already called
         */
        if (this.localVideo.nativeElement.srcObject != null &&
          this.localVideo.nativeElement.srcObject instanceof MediaStream) {
          this.localVideo.nativeElement.srcObject.getTracks().forEach(value1 => {
            peerConnection.addTrack(value1);
          });
        }

        /**
         * Set offer as remote description and create new answer for sending it back to them
         */
        await peerConnection.setRemoteDescription(offer.sdp);
        await peerConnection.setLocalDescription(await peerConnection.createAnswer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true,
        }));

        this.ioConnection.emit('transfer-answer', {
          sdp: peerConnection.localDescription,
          senderId: this.ioConnection.id,
          receiverId: offer.senderId,
        });
      });

      /**
       * Event when user got answer (after sent offer usually)
       */
      this.ioConnection.on('on-received-answer', async (answer: Answer) => {
        console.log('on-received-answer', answer);

        /**
         * Set answer as remote description
         */
        const peerConnection = this.getOrCreatePeerConnection(answer.senderId);
        await peerConnection.setRemoteDescription(answer.sdp);
      });

      /**
       * Event when user got ice candidate, used for finding way to connect to another user and vice versa
       */
      this.ioConnection.on('on-received-candidate', async (candidate: Candidate) => {
        console.log('on-received-candidate', candidate);

        /**
         * Add ice candidate
         */
        const peerConnection = this.getOrCreatePeerConnection(candidate.senderId);
        await peerConnection.addIceCandidate(candidate.candidate);
      });

      /**
       * Event when one user not themselves left from server
       */
      this.ioConnection.on('on-user-disconnect', (userId: string) => {
        console.log('on-user-disconnect', userId);

        /**
         * Remove redundant peer connection and stream data
         */
        this.removePeerConnection(userId);
        this.removeStream(userId);
      });

      /**
       * Event when server is disconnected
       */
      this.ioConnection.on('disconnect', () => {
        console.log('disconnect');

        this.removeAllPeerConnection();
      });

      /**
       * Load user stream data first
       */
      await this.getUserStreamData();

      /**
       * Join some room
       */
      this.ioConnection.emit('join-room', 0);
    } catch (e) {
      console.log(e);
    }
  }

  ngOnDestroy() {
    for (const item of this.peerConnectionMap.values()) {
      item.close();
    }
    for (const item of this.targetUserStreamDataMap.values()) {
      item.getTracks().forEach(value => {
        value.stop();
      });
    }
    this.peerConnectionMap.clear();
    this.targetUserStreamDataMap.clear();
    this.ioConnection.close();
  }

  async checkRTCAvailability() {
    if (this.platform.is("android") || this.platform.is('ios')) {
      await this.checkMobileRTCAvailability();
    } else {
      await this.checkWebRTCAvailability();
    }
  }

  async checkMobileRTCAvailability() {
    console.log(DetectRTC.isWebRTCSupported);
    if (!DetectRTC.isWebRTCSupported) { throw new RTCNotSupportedError(); }

    if (this.platform.is('ios')) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1, height: 1 }})
        .catch(() => undefined);

      if (videoStream == null) {
        throw new RTCNoAvailableMicrophoneError();
      } else {
        videoStream.getTracks().forEach(value => {
          value.stop();
        });
      }
    }
    if (!(await this.diagnostic.isCameraAvailable())) {
      throw new RTCNoAvailableCameraError();
    }

    if (this.platform.is('ios')) {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 1 } })
        .catch(() => undefined);

      if (audioStream == null) {
        throw new RTCNoAvailableMicrophoneError();
      } else {
        audioStream.getTracks().forEach(value => {
          value.stop();
        });
      }
    }
    if (!(await this.diagnostic.isMicrophoneAuthorized())) {
      throw new RTCNoAvailableMicrophoneError();
    }
  }

  async checkWebRTCAvailability() {
    console.log(DetectRTC.isWebRTCSupported);
    console.log(DetectRTC.hasWebcam);
    console.log(DetectRTC.hasMicrophone);
    if (!DetectRTC.isWebRTCSupported) { throw new RTCNotSupportedError(); }

    const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1, height: 1 }})
      .catch(() => undefined);
    if (!videoStream?.getTracks().some(value => value != null && !value.enabled) || !DetectRTC.hasWebcam) {
      throw new RTCNoAvailableCameraError();
    } else {
      videoStream.getTracks().forEach(value => {
        value.stop();
      });
    }

    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 1 } })
      .catch(() => undefined);

    if (!audioStream?.getTracks().some(value => value != null && value.enabled) || !DetectRTC.hasMicrophone) {
      throw new RTCNoAvailableMicrophoneError();
    } else {
      audioStream.getTracks().forEach(value => {
        value.stop();
      });
    }
  }

  getOrCreatePeerConnection(remoteId: string) {
    if (remoteId != null) {
      const peerConnection = this.peerConnectionMap.get(remoteId);

      if (peerConnection != null) {
        return peerConnection;
      }
    }

    const newPeerConnection = new RTCPeerConnection({
      iceServers: environment.iceServers,
    });

    /**
     * onicecandidate occurs where two peer connections got opponent sdp data and
     * two unique candidate data of each peer connections are about to be shared back
     */
    newPeerConnection.onicecandidate = event => {
      console.log('onicecandidate', event);

      if (event?.candidate != null) {
        this.ioConnection.emit('transfer-candidate', {
          candidate: event.candidate,
          senderId: this.ioConnection.id,
          receiverId: remoteId,
        } as Candidate);
      }
    };

    /**
     * ontrack occurs when opponent added track, containing stream
     * @param event data
     */
    newPeerConnection.ontrack = event => {
      console.log('ontrack', event);

      /**
       * Add track to existing or new media stream to be shown in device
       */
      const item = this.targetUserStreamDataMap.get(remoteId) ?? new MediaStream();
      item.addTrack(event.track);
      this.targetUserStreamDataMap.set(remoteId, item);
    };

    newPeerConnection.onconnectionstatechange = async (event) => {
      console.log('onconnectionstatechange', event);
    };

    newPeerConnection.onnegotiationneeded = async (event) => {
      console.log('onnegotiationneeded', event);
    };

    newPeerConnection.oniceconnectionstatechange = (event) => {
      console.log('oniceconnectionstatechange', event);
    }

    this.peerConnectionMap.set(remoteId, newPeerConnection);
    return newPeerConnection;
  }

  removePeerConnection(remoteId: string) {
    if (remoteId == null) { return; }
    const peerConnection = this.peerConnectionMap.get(remoteId);
    if (peerConnection != null) {
      peerConnection.close();
    }
    this.peerConnectionMap.delete(remoteId);
  }

  removeStream(remoteId: string) {
    if (remoteId == null) { return; }
    const streamData = this.targetUserStreamDataMap.get(remoteId);
    if (streamData != null) {
      streamData.getTracks().forEach(value => {
        value.stop();
      });
    }
    this.targetUserStreamDataMap.delete(remoteId);
  }

  removeAllPeerConnection() {
    const data = Array.from(this.peerConnectionMap.values());
    while(data.length > 0) {
      data.pop().close();
    }
  }

  removeAllCurrentConnection() {
    if (this.ioConnection == null) { return; }
    const data = Array.from(this.peerConnectionMap.keys());
    data.forEach(value => {
      this.ioConnection.emit('remove-connection', value);
    });
  }

  /**
   * Create new offers for specific user ids
   * @param userIds
   */
  sendOffers(userIds: string[]) {
    if (this.ioConnection == null) { return; }
    userIds.forEach(async value => {

      /**
       * Create peer connection for offer sender and allocate data tracks
       */
      const peerConnection = this.getOrCreatePeerConnection(value);
      /**
       * Be aware of data track allocation due to data won't be transferred without any errors if
       * setLocalDescription or setRemoteDescription is already called
       */
      if (this.localVideo.nativeElement.srcObject != null && this.localVideo.nativeElement.srcObject instanceof MediaStream) {
        this.localVideo.nativeElement.srcObject.getTracks().forEach(value1 => {
          peerConnection.addTrack(value1);
        });
      }

      await peerConnection.setLocalDescription(await peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      }));

      this.ioConnection.emit('transfer-offer', {
        sdp: peerConnection.localDescription,
        senderId: this.ioConnection.id,
        receiverId: value,
      });
    });
  }

  async getUserStreamData() {
    this.localUserStreamData = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });

    this.localVideo.nativeElement.srcObject = this.localUserStreamData;

    if (this.peerConnectionMap.size > 0) {
      const userIds = Array.from(this.peerConnectionMap.keys());
      this.removeAllCurrentConnection();
      this.sendOffers(userIds);
    }
  }
}
