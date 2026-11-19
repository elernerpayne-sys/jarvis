import { useInstall } from '@/lib/install'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Page'

const IOS_STEPS = ['Open this page in Safari', 'Tap Share', 'Tap Add to Home Screen']

/** Putting Jarvis on the home screen, in whichever way this device allows. */
export function InstallSection() {
  const install = useInstall()

  return (
    <Section title="On your phone">
      {install.standalone ? (
        <p className="text-base text-ash">Jarvis is installed on this device.</p>
      ) : install.canPrompt ? (
        <Button onClick={() => void install.prompt()}>Add to home screen</Button>
      ) : install.ios ? (
        <ol className="list-decimal space-y-2 pl-5 text-base text-ash marker:text-smoke">
          {IOS_STEPS.map((step) => (
            <li key={step} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-base text-ash">
          Open this page on your phone, then choose Add to Home Screen (or Install app) from the browser menu.
        </p>
      )}
    </Section>
  )
}
