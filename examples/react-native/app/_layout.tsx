import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Voltra SDK',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
