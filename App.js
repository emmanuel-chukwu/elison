import { AppLoading } from 'expo';
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';
import React from 'react';
import { Platform, StatusBar, StyleSheet, View, AsyncStorage } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Permissions from 'expo-permissions';
import {Notifications} from 'expo';
import { Audio } from 'expo-av'; 
import { INTERRUPTION_MODE_ANDROID_DO_NOT_MIX, INTERRUPTION_MODE_IOS_DO_NOT_MIX } from 'expo-av/build/Audio';

import AppNavigator from './navigation/AppNavigator';
import Signup from './screens/auth/Onboarding';
import RingerScreen from './screens/RingerScreen';
import CallScreenReceiver from './screens/CallScreenReceiver';

import Socket from './screens/providers/SocketReceive';
import History from './screens/providers/History';
import Settings from './screens/providers/Settings';

const BACKGROUND_FETCH_TASK = 'background-phone-call';
const RingTone = new Audio.Sound();

export default class App extends React.Component {
  state = {
    activeCallUser: {},
    isLoadingComplete: false,
    user: null,
    incomingCall: false,
    liveCall: false,
    userLeftCall: false,
    ringDetails: {},
    messageList: [],
    isTyping: false,
    room: '',
    userPhone: '',
    userPhoneE16: '',
  }

  componentWillMount() {
    AsyncStorage.getItem('user')
    .then(value => {
      if (!value) return;
      value = JSON.parse(value);
      this.setState({
        user: value,
        userPhoneE16: value.details.calling_code + value.phone,
        userPhone: '0' + value.phone,
      });
      if (value) {
        Socket.connect(this);
        Socket.listenToCalls(this);
        Socket.listenToNewMessages(this);
      }
      registerBackgroundPhoneCall();     
    });
  }

  async loadResourcesAsync() {
    await Promise.all([
      Asset.loadAsync([
        require('./assets/images/robot-dev.png'),
        require('./assets/images/robot-prod.png'),
      ]),
      Font.loadAsync({
        ...Ionicons.font,
        'space-mono': require('./assets/fonts/SpaceMono-Regular.ttf'),
        'sf': require('./assets/fonts/SFProText-Regular.ttf'),
      }),
    ]);
  }
  
  handleLoadingError = error => console.warn(error);

  handleFinishLoading() {
    this.setState({isLoadingComplete: true});
  }

  setUser = (user) => {
    AsyncStorage.setItem('user', JSON.stringify(user));
    this.setState({user})
  }

  registerPhoneCall(data) {
    this.setupRingTone();
    this.showCallNotification(data);
    try {
      this.changeCallState({liveCall: false, incomingCall: true});
      this.Ring(data);
    } catch (error) {
      console.log(error)
    }
  }
  
  setupRingTone() {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
      interruptionModeIOS: INTERRUPTION_MODE_IOS_DO_NOT_MIX
    });
  }
  
  Ring(data) {
    this.setState({ringDetails: data})
    Settings.getRingTone()
    .then(async (userRingtone) => {
      this.setState({ringTone: userRingtone.file});
      await RingTone.loadAsync(userRingtone.file);
      await RingTone.playAsync();
      setTimeout(() => {
        this.FinishRing();
      }, 30000);
    })
  }

  saveMissedCallToHistory = (data) => {
    History.saveToHistory({
      type: 'missed',
      data,
      time: new Date().getTime()
    });
  }
  
  async showCallNotification(data) {
    let result = await Permissions.askAsync(Permissions.NOTIFICATIONS); 
    if (result.status === 'granted') {
      const localNotification = {
        title: 'Incoming Call',
        body: data.name,
        data,
        icon: '../../assets/images/logo_notification.png',
        sticky: false,
      };
      Notifications.presentLocalNotificationAsync(localNotification)
    }
  }
  
  FinishRing() {
    this.stopRinging();
    this.unregisterBackgroundPhoneCall();
  }

  async stopRinging(liveCall = false) {
    await RingTone.stopAsync();
    await RingTone.unloadAsync(this.ringTone);
    if (liveCall) {
      this.changeCallState({liveCall, incomingCall: false});
    }
    else {
      this.changeCallState({liveCall: false, incomingCall: false});
    }
  }

  acceptCall = () => {
    History.saveToHistory({
      type: 'received',
      data: this.state.ringDetails,
      time: new Date().getTime()
    });
    this.stopRinging(true);
    this.changeCallState({liveCall: true, incomingCall: false});
    Socket.acceptCall();
  }

  rejectCall = () => {
    History.saveToHistory({
      type: 'received',
      data: this.state.ringDetails,
      time: new Date().getTime()
    });
    this.FinishRing();
    this.setState({messageList: []});
    Socket.rejectCall();
  }

  changeCallState = ({liveCall, incomingCall}) => {
    this.setState({liveCall, incomingCall});
  }

  startTyping = () => this.setState({isTyping: true});

  stopTyping = () => this.setState({isTyping: false});

  emitTyping = (state) => Socket.emitTyping(this, state);

  unregisterBackgroundPhoneCall() {
    BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
  }
  
  sendMessage = (message) => {
    Socket.sendMessage({sender: this.state.userPhoneE16, name: '', message});
  }

  endCall = () => {
    this.setState({
      messageList: [],
      liveCall: false,
      startingCall: false
    });
    Socket.endCall();
  }
  
  renderAppLoader = () => <AppLoading
        startAsync={this.loadResourcesAsync}
        onError={this.handleLoadingError}
        onFinish={() => this.handleFinishLoading()}
      />;

  renderAuth = () => <View style={styles.container}>
        {Platform.OS === 'ios' && <StatusBar barStyle="default" />}
        <Signup setUser={this.setUser} />
      </View>;

  renderCallScreenReceiver = () => <CallScreenReceiver
        caller={this.state.ringDetails}
        messageList={this.state.messageList}
        endCall={this.endCall}
        emitTyping={this.emitTyping}
        sendMessage={this.sendMessage}
        user={this.state.activeCallUser}
        userLeftCall={this.state.userLeftCall}
        isTyping={this.state.isTyping}
        changeCallState={this.changeCallState}
        phones={{phone: this.state.userPhone, phoneE16: this.state.userPhoneE16}}
      />

  renderRinger = () => <RingerScreen
        type = {'incoming'}
        callState={this.state.outgoingCallState}
        caller={this.state.ringDetails}
        endCall = {this.endCall}
        rejectCall = {this.rejectCall}
        acceptCall = {this.acceptCall}
      />

  renderAppNavigation = () => <View style={styles.container}>
        {Platform.OS === 'ios' && <StatusBar barStyle="default" />}
        <AppNavigator />
      </View>;

  currentContent = () => {
    if (!this.state.isLoadingComplete && !this.props.skipLoadingScreen) return this.renderAppLoader();

    if (!this.state.user) return this.renderAuth();
    else if (this.state.incomingCall) return this.renderRinger();
    else if (this.state.liveCall) return this.renderCallScreenReceiver();
    else return this.renderAppNavigation();
  }

  render() {
    return this.currentContent()
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async ({data, error}) => {
  try {
    Socket.connect(this);
    Socket.listenToCalls(this);
    Socket.listenToNewMessages(this);
    return BackgroundFetch.Result.NewData;
    
  } catch (error) {
    return BackgroundFetch.Result.Failed;
  }
})

function registerBackgroundPhoneCall() {
  BackgroundFetch.getStatusAsync()
  .then(resp => {
    if (resp == BackgroundFetch.Status.Available) {
      BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 10,
        stopOnTerminate: false,
        startOnBoot: false
      });
    }
    BackgroundFetch.setMinimumIntervalAsync(60);
  });
}

