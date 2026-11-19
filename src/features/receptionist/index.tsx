import { Navigate, Route, Routes } from 'react-router'

import { routes } from '@/lib/links'
import { ShopScreen } from '@/features/receptionist/ShopScreen'
import { ShopsScreen } from '@/features/receptionist/ShopsScreen'

/**
 * Receptionist: the barbershops Jarvis answers for, and inside each one its
 * appointments and call log. Mounted at "/receptionist/*".
 */
export default function Receptionist() {
  return (
    <Routes>
      <Route index element={<ShopsScreen />} />
      <Route path=":shopId" element={<ShopScreen />} />
      <Route path="*" element={<Navigate to={routes.receptionist} replace />} />
    </Routes>
  )
}
