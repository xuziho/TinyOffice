import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './app/App.tsx'
import { UnsavedChangesProvider } from './config/UnsavedChangesProvider.tsx'
import { OwnerAuthGate } from './auth/OwnerAuthGate.tsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <OwnerAuthGate><App /></OwnerAuthGate>
      </UnsavedChangesProvider>
    </QueryClientProvider>
  </StrictMode>,
)
