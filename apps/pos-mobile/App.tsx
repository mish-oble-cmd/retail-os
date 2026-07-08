import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import tokens from '@retailos/ui/tokens/tokens.json';

/**
 * Phase 0 spike (phase-0-foundations.md §0.5): the app boots, renders the
 * Counter tokens (proving the JSON export works on RN), and reads an EAN
 * barcode with the camera. Real POS screens are Phase 3.
 */

const light = tokens.color.light;

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>RetailOS POS</Text>
        <Text style={styles.subtitle}>Phase 0 spike: tokens + barcode scan</Text>

        <Text style={styles.sectionLabel}>Counter tokens (from @retailos/ui JSON export)</Text>
        <View style={styles.swatchRow}>
          {Object.entries(light).map(([name, value]) => (
            <View key={name} style={styles.swatchItem}>
              <View style={[styles.swatch, { backgroundColor: value }]} />
              <Text style={styles.swatchLabel}>{name}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Barcode scan spike (EAN-13 / EAN-8)</Text>
        {scanning && permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8'] }}
            onBarcodeScanned={({ data }) => {
              setLastScan(data);
              setScanning(false);
            }}
          />
        ) : (
          <Pressable
            style={styles.button}
            onPress={async () => {
              if (!permission?.granted) {
                const result = await requestPermission();
                if (!result.granted) return;
              }
              setScanning(true);
            }}
          >
            <Text style={styles.buttonText}>{lastScan ? 'Scan again' : 'Scan a barcode'}</Text>
          </Pressable>
        )}
        {lastScan ? <Text style={styles.scanResult}>Last scanned: {lastScan}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: light.bg },
  content: { padding: 24, paddingTop: 72, gap: 8 },
  title: { fontSize: 30, fontWeight: '600', color: light.ink },
  subtitle: { fontSize: 16, color: light['ink-muted'], marginBottom: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '500', color: light['ink-muted'], marginTop: 16 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  swatchItem: { alignItems: 'center', width: 72 },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: light.border,
  },
  swatchLabel: { fontSize: 10, color: light['ink-muted'], marginTop: 4 },
  camera: { height: 280, borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  button: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: light.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  scanResult: { fontSize: 18, color: light.success, marginTop: 12, fontWeight: '600' },
});
