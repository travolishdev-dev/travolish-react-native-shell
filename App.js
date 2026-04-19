import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const APP_URL = 'https://travolish.vercel.app/';
const DEFAULT_NOTIFICATION_CHANNEL_ID = 'default';
const REPLY_NOTIFICATION_CATEGORY_ID = 'travolishReply';
const REPLY_NOTIFICATION_ACTION_ID = 'travolishReplyAction';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getExpoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

function buildAppUrl({ location, locationPermission, notificationPermission, pushToken }) {
  const url = new URL(APP_URL);

  url.searchParams.set('source', 'react-native-app');
  url.searchParams.set('platform', Platform.OS);
  url.searchParams.set('locationPermission', locationPermission);
  url.searchParams.set('notificationPermission', notificationPermission);

  if (location?.coords?.latitude != null && location?.coords?.longitude != null) {
    url.searchParams.set('latitude', String(location.coords.latitude));
    url.searchParams.set('longitude', String(location.coords.longitude));
  }

  if (pushToken) {
    url.searchParams.set('pushToken', pushToken);
  }

  return url.toString();
}

function formatLocationForWeb(coords) {
  if (!coords) {
    return null;
  }

  return {
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      altitude: coords.altitude ?? null,
      altitudeAccuracy: coords.altitudeAccuracy ?? null,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
    },
    timestamp: Date.now(),
  };
}

function formatNotificationPayload(notification) {
  if (!notification) {
    return null;
  }

  const content = notification.request?.content;
  const trigger = notification.request?.trigger;
  const remoteNotification =
    trigger?.type === 'push' ? trigger.remoteMessage?.notification ?? null : null;
  const data = content?.data ?? null;
  const normalizedCategoryIdentifier =
    content?.categoryIdentifier ??
    (typeof data?.categoryId === 'string' ? data.categoryId : null);
  const normalizedImageUrl =
    remoteNotification?.imageUrl ?? (typeof data?.imageUrl === 'string' ? data.imageUrl : null);
  const normalizedSound =
    remoteNotification?.sound ??
    (typeof content?.sound === 'string' ? content.sound : content?.sound ? 'default' : null);

  return {
    title: content?.title ?? null,
    subtitle: content?.subtitle ?? null,
    body: content?.body ?? null,
    data,
    categoryIdentifier: normalizedCategoryIdentifier,
    channelId: remoteNotification?.channelId ?? null,
    imageUrl: normalizedImageUrl,
    sound: normalizedSound,
    sentAt: notification.date ?? null,
  };
}

function formatNotificationResponse(response) {
  if (!response) {
    return null;
  }

  return {
    type: 'response',
    actionIdentifier: response.actionIdentifier,
    userText: response.userText ?? null,
    notification: formatNotificationPayload(response.notification),
  };
}

function escapeForInjection(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const injectedBridge = `
  (function () {
    if (window.__travolishBridgeInstalled) {
      return true;
    }

    window.__travolishBridgeInstalled = true;
    window.__travolishNative = window.__travolishNative || {};

    var watchers = {};
    var nextWatchId = 0;

    function emitEvent(name, detail) {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail: detail }));
      } catch (error) {}
    }

    function buildPosition(location) {
      return {
        coords: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          altitude: location.coords.altitude,
          altitudeAccuracy: location.coords.altitudeAccuracy,
          heading: location.coords.heading,
          speed: location.coords.speed,
        },
        timestamp: location.timestamp,
      };
    }

    function buildLocationError(message) {
      return {
        code: 1,
        message: message || 'Location unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      };
    }

    function notifyWatchers() {
      var location = window.__travolishNative.location;
      var locationError = window.__travolishNative.locationError;

      Object.keys(watchers).forEach(function (watchId) {
        var watcher = watchers[watchId];

        if (!watcher) {
          return;
        }

        if (location && watcher.success) {
          watcher.success(buildPosition(location));
          return;
        }

        if (locationError && watcher.error) {
          watcher.error(buildLocationError(locationError));
        }
      });
    }

    window.TravolishNativeApp = {
      postMessage: function (type, payload) {
        if (!window.ReactNativeWebView) {
          return;
        }

        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: type, payload: payload || null })
        );
      },
    };

    window.__travolishSetNativeContext = function (context) {
      window.__travolishNative = Object.assign({}, window.__travolishNative, context || {});
      emitEvent('travolish:native-context', window.__travolishNative);

      if (window.__travolishNative.lastNotification) {
        emitEvent('travolish:notification', window.__travolishNative.lastNotification);
      }

      notifyWatchers();
    };

    if (!navigator.geolocation) {
      navigator.geolocation = {};
    }

    navigator.geolocation.getCurrentPosition = function (success, error) {
      if (window.__travolishNative.location && success) {
        success(buildPosition(window.__travolishNative.location));
        return;
      }

      if (window.__travolishNative.locationError && error) {
        error(buildLocationError(window.__travolishNative.locationError));
        return;
      }

      window.TravolishNativeApp.postMessage('requestLocation');
    };

    navigator.geolocation.watchPosition = function (success, error) {
      nextWatchId += 1;
      watchers[nextWatchId] = { success: success, error: error };

      if (window.__travolishNative.location && success) {
        success(buildPosition(window.__travolishNative.location));
      } else if (window.__travolishNative.locationError && error) {
        error(buildLocationError(window.__travolishNative.locationError));
      } else {
        window.TravolishNativeApp.postMessage('requestLocation');
      }

      return nextWatchId;
    };

    navigator.geolocation.clearWatch = function (watchId) {
      delete watchers[watchId];
    };

    emitEvent('travolish:native-ready', { source: 'react-native-webview' });
    return true;
  })();
`;

export default function App() {
  const webViewRef = useRef(null);
  const notificationListener = useRef(null);
  const notificationResponseListener = useRef(null);
  const pushTokenListener = useRef(null);
  const hasSentLocalTestNotificationRef = useRef(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [locationPermission, setLocationPermission] = useState('undetermined');
  const [notificationPermission, setNotificationPermission] = useState('undetermined');
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [pushToken, setPushToken] = useState(null);
  const [lastNotification, setLastNotification] = useState(null);
  const [webUri, setWebUri] = useState(APP_URL);
  const [showLocationModal, setShowLocationModal] = useState(false);

  const syncWebViewContext = (overrideContext) => {
    if (!webViewRef.current) {
      return;
    }

    const context = overrideContext ?? {
      source: 'react-native-app',
      platform: Platform.OS,
      permissions: {
        location: locationPermission,
        notifications: notificationPermission,
      },
      location,
      locationError,
      pushToken,
      lastNotification,
    };

    webViewRef.current.injectJavaScript(`
      window.__travolishSetNativeContext && window.__travolishSetNativeContext(${escapeForInjection(context)});
      true;
    `);
  };

  const registerReplyNotificationCategory = async () => {
    await Notifications.setNotificationCategoryAsync(
      REPLY_NOTIFICATION_CATEGORY_ID,
      [
        {
          identifier: REPLY_NOTIFICATION_ACTION_ID,
          buttonTitle: 'Reply',
          textInput: {
            placeholder: 'Type your reply',
            submitButtonTitle: 'Send',
          },
        },
      ],
      {
        previewPlaceholder: 'New message',
        showTitle: true,
        showSubtitle: true,
      }
    );
  };

  const refreshExpoPushToken = async () => {
    const projectId = getExpoProjectId();

    if (!projectId) {
      throw new Error('No EAS projectId found in app config');
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse?.data;

    if (!token) {
      throw new Error('Token response has no data field');
    }

    setPushToken(token);
    return token;
  };

  const requestLocationAccess = async (shouldAlert = false) => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(permission.status);

      if (permission.status !== 'granted') {
        setLocation(null);
        setLocationError('Location permission was not granted');
        setShowLocationModal(true);

        if (shouldAlert) {
          Alert.alert(
            'Location permission needed',
            'Enable location access so the site can capture trip and itinerary details.'
          );
        }

        return {
          location: null,
          permissionStatus: permission.status,
          locationError: 'Location permission was not granted',
        };
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const formattedLocation = formatLocationForWeb(currentPosition.coords);
      setLocation(formattedLocation);
      setLocationError(null);
      setShowLocationModal(false);

      return {
        location: formattedLocation,
        permissionStatus: permission.status,
        locationError: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to fetch location';
      setLocation(null);
      setLocationError(message);
      setShowLocationModal(true);

      if (shouldAlert) {
        Alert.alert('Location unavailable', message);
      }

      return {
        location: null,
        permissionStatus: 'error',
        locationError: message,
      };
    }
  };

  const requestNotificationAccess = async (shouldAlert = false) => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#2E6BFF',
          sound: 'default',
        });
      }

      try {
        await registerReplyNotificationCategory();
      } catch (categoryError) {
        console.warn('Unable to register reply notification category', categoryError);
      }

      if (!Device.isDevice) {
        setNotificationPermission('device-required');
        return {
          permissionStatus: 'device-required',
          pushToken: null,
        };
      }

      if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
        const message =
          'Expo Go does not support remote push notifications in Expo SDK 53 and later. Use an EAS development build or a production build on a physical device.';

        if (shouldAlert) {
          Alert.alert('Development build required', message);
        }

        setNotificationPermission('development-build-required');
        setPushToken(null);
        return {
          permissionStatus: 'development-build-required',
          pushToken: null,
        };
      }

      let permission = await Notifications.getPermissionsAsync();

      if (permission.status !== 'granted') {
        permission = await Notifications.requestPermissionsAsync();
      }

      setNotificationPermission(permission.status);

      if (permission.status !== 'granted') {
        if (shouldAlert) {
          Alert.alert(
            'Notifications permission needed',
            'Enable notifications if you want the site to send travel alerts to this device.'
          );
        }

        setPushToken(null);
        return {
          permissionStatus: permission.status,
          pushToken: null,
        };
      }

      try {
        const token = await refreshExpoPushToken();

        return {
          permissionStatus: permission.status,
          pushToken: token,
        };
      } catch (tokenError) {
        const tokenErrorMsg = tokenError instanceof Error ? tokenError.message : 'Unknown error getting token';
        Alert.alert('Token Error', tokenErrorMsg);
        setPushToken(null);
        return {
          permissionStatus: permission.status,
          pushToken: null,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to register for notifications';

      if (shouldAlert) {
        Alert.alert('Notifications unavailable', message);
      }

      setNotificationPermission('error');
      setPushToken(null);

      return {
        permissionStatus: 'error',
        pushToken: null,
      };
    }
  };

  const sendLocalTestNotification = async () => {
    if (hasSentLocalTestNotificationRef.current) {
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Travolish Test Notification',
          subtitle: 'Inline reply preview',
          body: 'Reply directly from the notification to test the native flow.',
          data: {
            source: 'local-test',
            categoryId: REPLY_NOTIFICATION_CATEGORY_ID,
            supportsInlineReply: true,
          },
          sound: 'default',
          categoryIdentifier: REPLY_NOTIFICATION_CATEGORY_ID,
        },
        trigger: Platform.OS === 'android' ? { channelId: DEFAULT_NOTIFICATION_CHANNEL_ID } : null,
      });
      hasSentLocalTestNotificationRef.current = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send local test notification';
      Alert.alert('Notification test failed', message);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      const initialResponse = await Notifications.getLastNotificationResponseAsync();

      if (initialResponse) {
        setLastNotification(formatNotificationResponse(initialResponse));
        await Notifications.clearLastNotificationResponseAsync();
      }

      const locationState = await requestLocationAccess();
      const notificationState = await requestNotificationAccess();

      if (!isMounted) {
        return;
      }

      setWebUri(
        buildAppUrl({
          location: locationState.location,
          locationPermission: locationState.permissionStatus,
          notificationPermission: notificationState.permissionStatus,
          pushToken: notificationState.pushToken,
        })
      );
      setIsBootstrapping(false);
    };

    notificationListener.current = Notifications.addNotificationReceivedListener((event) => {
      setLastNotification({ type: 'received', notification: formatNotificationPayload(event) });
    });

    pushTokenListener.current = Notifications.addPushTokenListener((tokenEvent) => {
      void refreshExpoPushToken().catch((error) => {
        console.warn('Unable to refresh Expo push token', error, tokenEvent);
      });
    });

    notificationResponseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        setLastNotification(formatNotificationResponse(response));
        void Notifications.clearLastNotificationResponseAsync();
      }
    );

    void bootstrap();

    return () => {
      isMounted = false;

      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }

      if (pushTokenListener.current) {
        Notifications.removeNotificationSubscription(pushTokenListener.current);
      }

      if (notificationResponseListener.current) {
        Notifications.removeNotificationSubscription(notificationResponseListener.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isBootstrapping) {
      syncWebViewContext();
    }
  }, [isBootstrapping, lastNotification, location, locationError, locationPermission, notificationPermission, pushToken]);

  useEffect(() => {
    if (!isBootstrapping && notificationPermission === 'granted') {
      void sendLocalTestNotification();
    }
  }, [isBootstrapping, notificationPermission]);

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    const nextUri = buildAppUrl({
      location,
      locationPermission,
      notificationPermission,
      pushToken,
    });

    setWebUri((currentUri) => (currentUri === nextUri ? currentUri : nextUri));
  }, [isBootstrapping, location, locationPermission, notificationPermission, pushToken]);

  const handleWebMessage = async (event) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      if (message?.type === 'requestLocation') {
        const nextLocationState = await requestLocationAccess(true);
        syncWebViewContext({
          source: 'react-native-app',
          platform: Platform.OS,
          permissions: {
            location: nextLocationState.permissionStatus,
            notifications: notificationPermission,
          },
          location: nextLocationState.location,
          locationError: nextLocationState.locationError,
          pushToken,
          lastNotification,
        });
        return;
      }

      if (message?.type === 'requestNotificationPermission') {
        const nextNotificationState = await requestNotificationAccess(true);

        if (nextNotificationState.permissionStatus === 'granted') {
          void sendLocalTestNotification();
        }

        syncWebViewContext({
          source: 'react-native-app',
          platform: Platform.OS,
          permissions: {
            location: locationPermission,
            notifications: nextNotificationState.permissionStatus,
          },
          location,
          locationError,
          pushToken: nextNotificationState.pushToken,
          lastNotification,
        });
        return;
      }

      if (message?.type === 'openExternalUrl' && message.payload?.url) {
        await Linking.openURL(message.payload.url);
      }
    } catch (error) {}
  };

  if (isBootstrapping) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ExpoStatusBar style="dark" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#2E6BFF" size="large" />
          <Text style={styles.loadingTitle}>Preparing Travolish</Text>
          <Text style={styles.loadingText}>Requesting permissions and loading the web experience.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ uri: webUri }}
          userAgent="Chrome/120 Safari/537.36); Mozilla/5.0 (Linux; Android 10"
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={injectedBridge}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          allowsFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          startInLoadingState
          onLoadEnd={() => syncWebViewContext()}
          onMessage={handleWebMessage}
          onShouldStartLoadWithRequest={(request) => {
            if (/^(mailto:|tel:|sms:|maps:)/i.test(request.url)) {
              void Linking.openURL(request.url);
              return false;
            }

            return true;
          }}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#2E6BFF" size="large" />
              <Text style={styles.loadingTitle}>Loading Travolish</Text>
            </View>
          )}
        />

        {/* <View style={styles.tokenPanel}>
          <Text style={styles.tokenPanelLabel}>Push Token</Text>
          <Text selectable style={styles.tokenPanelValue}>
            {pushToken || 'Waiting for notification permission and token...'}
          </Text>
        </View> */}

        <Modal
          animationType="fade"
          transparent
          visible={showLocationModal}
          onRequestClose={() => setShowLocationModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Location Permission Required</Text>
              <Text style={styles.modalText}>
                Location is required to fetch properties near you. Please allow location access to continue.
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSecondary]}
                  onPress={() => setShowLocationModal(false)}
                >
                  <Text style={styles.modalButtonSecondaryText}>Not now</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonPrimary]}
                  onPress={() => {
                    void requestLocationAccess(true);
                  }}
                >
                  <Text style={styles.modalButtonPrimaryText}>Allow Location</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  tokenPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(22, 33, 62, 0.92)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  tokenPanelLabel: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  tokenPanelValue: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 17,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#16213E',
  },
  loadingText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#4A5568',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#16213E',
  },
  modalText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4A5568',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalButtonPrimary: {
    backgroundColor: '#2E6BFF',
  },
  modalButtonSecondary: {
    backgroundColor: '#EEF2FF',
  },
  modalButtonPrimaryText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  modalButtonSecondaryText: {
    color: '#1F2A44',
    fontWeight: '600',
  },
});
