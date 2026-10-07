'use client'
import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { Input } from '@/components/ui/Input'

type Props = Omit<ComponentProps<typeof Input>, 'type' | 'variant' | 'trailing' | 'leadingIcon'> & { statusIcon?: ReactNode }

export const PasswordInput = forwardRef<HTMLInputElement, Props>(({ statusIcon, ...props }, ref) => {
  const [visible, setVisible] = useState(false)
  return <Input ref={ref} variant="auth" type={visible ? 'text' : 'password'} leadingIcon={<Lock size={20} />}
    autoCapitalize="none" autoCorrect="off" spellCheck={false}
    trailing={<>{statusIcon}<button type="button" onMouseDown={event => event.preventDefault()} onClick={() => setVisible(value => !value)}
      aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
      className="-mr-3 grid h-11 w-11 place-items-center rounded-xl text-[var(--text2)] hover:text-[var(--text)]">{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></>}
    {...props} />
})
PasswordInput.displayName = 'PasswordInput'
