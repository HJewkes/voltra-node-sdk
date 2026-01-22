/**
 * React Native Example
 *
 * Demonstrates the simplified SDK API with React hooks.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { VoltraManager, type DiscoveredDevice, type VoltraClient } from '@voltra/node-sdk';
import { useVoltraScanner, useVoltraDevice } from '@voltra/node-sdk/react';

export default function WorkoutScreen() {
  // Create manager for React Native
  const manager = useMemo(() => VoltraManager.forNative(), []);
  
  // Client state
  const [client, setClient] = useState<VoltraClient | null>(null);

  // Scanner hook
  const { devices, isScanning, scan, error: scanError } = useVoltraScanner(manager);

  // Device state hook
  const { connectionState, isConnected, isRecording, currentFrame, settings } = useVoltraDevice(client);

  // Selected weight
  const [selectedWeight, setSelectedWeight] = useState(50);

  const handleScan = async () => {
    try {
      await scan({ timeout: 10000 });
    } catch (e) {
      Alert.alert('Scan Failed', String(e));
    }
  };

  const handleConnect = async (device: DiscoveredDevice) => {
    try {
      const connected = await manager.connect(device);
      setClient(connected);
      await connected.setWeight(selectedWeight);
    } catch (e) {
      Alert.alert('Connection Failed', String(e));
    }
  };

  const handleDisconnect = async () => {
    await manager.disconnectAll();
    setClient(null);
  };

  const handleWeightChange = async (weight: number) => {
    setSelectedWeight(weight);
    if (client?.isConnected) {
      try {
        await client.setWeight(weight);
      } catch (e) {
        Alert.alert('Error', `Failed to set weight: ${e}`);
      }
    }
  };

  const handleStartRecording = async () => {
    try {
      await client?.startRecording();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleStopRecording = async () => {
    try {
      await client?.stopRecording();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const renderDevice = ({ item }: { item: DiscoveredDevice }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => handleConnect(item)}
      disabled={isConnected}
    >
      <Text style={styles.deviceName}>{item.name ?? 'Unknown Device'}</Text>
      <Text style={styles.deviceId}>{item.id}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Voltra SDK Demo</Text>

      {/* Connection Status */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isConnected && styles.statusDotConnected]} />
          <Text style={styles.statusText}>
            {connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
          </Text>
        </View>
        {isConnected && (
          <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
            <Text style={styles.disconnectBtnText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Scanner */}
      {!isConnected && (
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.button, isScanning && styles.buttonDisabled]}
            onPress={handleScan}
            disabled={isScanning}
          >
            <Text style={styles.buttonText}>
              {isScanning ? 'Scanning...' : 'Scan for Devices'}
            </Text>
          </TouchableOpacity>

          {scanError && (
            <Text style={styles.errorText}>{scanError.message}</Text>
          )}

          <FlatList
            data={devices}
            renderItem={renderDevice}
            keyExtractor={(item) => item.id}
            style={styles.deviceList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {isScanning ? 'Searching...' : 'No devices found'}
              </Text>
            }
          />
        </View>
      )}

      {/* Connected Controls */}
      {isConnected && (
        <>
          {/* Weight Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Weight</Text>
            <View style={styles.weightRow}>
              {[25, 50, 75, 100].map((weight) => (
                <TouchableOpacity
                  key={weight}
                  style={[
                    styles.weightBtn,
                    selectedWeight === weight && styles.weightBtnSelected,
                  ]}
                  onPress={() => handleWeightChange(weight)}
                >
                  <Text
                    style={[
                      styles.weightBtnText,
                      selectedWeight === weight && styles.weightBtnTextSelected,
                    ]}
                  >
                    {weight} lbs
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Workout Controls */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Workout</Text>
            <View style={styles.workoutRow}>
              <TouchableOpacity
                style={[styles.button, styles.startBtn, isRecording && styles.buttonDisabled]}
                onPress={handleStartRecording}
                disabled={isRecording}
              >
                <Text style={styles.buttonText}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.stopBtn, !isRecording && styles.buttonDisabled]}
                onPress={handleStopRecording}
                disabled={!isRecording}
              >
                <Text style={styles.buttonText}>Stop</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Metrics */}
          <View style={styles.metricsCard}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.position.toFixed(0) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Position</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.velocity.toFixed(2) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Velocity</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.force.toFixed(0) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Force</Text>
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#4ecdc4', marginBottom: 16 },
  statusCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#666', marginRight: 8 },
  statusDotConnected: { backgroundColor: '#4ecdc4' },
  statusText: { color: '#eee', fontSize: 16 },
  disconnectBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#ff6b6b', borderRadius: 6 },
  disconnectBtnText: { color: '#fff', fontWeight: '600' },
  section: { marginBottom: 16 },
  sectionTitle: { color: '#888', fontSize: 14, marginBottom: 8 },
  button: { backgroundColor: '#4ecdc4', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#444' },
  buttonText: { color: '#1a1a2e', fontSize: 16, fontWeight: '600' },
  deviceList: { marginTop: 16, maxHeight: 200 },
  deviceItem: { backgroundColor: '#16213e', padding: 12, borderRadius: 8, marginBottom: 8 },
  deviceName: { color: '#eee', fontSize: 16, fontWeight: '600' },
  deviceId: { color: '#666', fontSize: 12, marginTop: 4 },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 16 },
  errorText: { color: '#ff6b6b', marginTop: 8 },
  weightRow: { flexDirection: 'row', gap: 8 },
  weightBtn: { flex: 1, padding: 12, backgroundColor: '#16213e', borderRadius: 8, alignItems: 'center' },
  weightBtnSelected: { backgroundColor: '#4ecdc4' },
  weightBtnText: { color: '#eee', fontWeight: '600' },
  weightBtnTextSelected: { color: '#1a1a2e' },
  workoutRow: { flexDirection: 'row', gap: 8 },
  startBtn: { flex: 1, backgroundColor: '#4ecdc4' },
  stopBtn: { flex: 1, backgroundColor: '#ff6b6b' },
  metricsCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 16, flexDirection: 'row' },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 28, fontWeight: 'bold', color: '#4ecdc4' },
  metricLabel: { color: '#888', fontSize: 12, marginTop: 4 },
});
