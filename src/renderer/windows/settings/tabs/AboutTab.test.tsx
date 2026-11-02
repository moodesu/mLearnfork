// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { AppUpdateState } from '../../../../shared/appUpdate';

const checkForUpdatesMock = vi.fn();
const getUpdateStateMock = vi.fn();
const downloadUpdateMock = vi.fn();
const installUpdateMock = vi.fn();
const openExternalUrlMock = vi.fn();
const updateSettingMock = vi.fn();
let updateListener: ((state: AppUpdateState) => void) | undefined;
let initialState: AppUpdateState;
let electronPlatform = true;

const settings = {
  automaticallyDownloadUpdates: true,
  devMode: false,
};

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings, updateSetting: updateSettingMock }),
  useLocalization: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}${values?.version ? ` ${values.version}` : ''}`,
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    server: {
      getVersion: vi.fn(),
      onVersionReceive: (callback: (version: string) => void) => {
        callback('2.6.7');
        return vi.fn();
      },
    },
    updates: {
      getUpdateState: getUpdateStateMock,
      checkForUpdates: checkForUpdatesMock,
      downloadUpdate: downloadUpdateMock,
      installUpdate: installUpdateMock,
      onUpdateStateChanged: (callback: (state: AppUpdateState) => void) => {
        updateListener = callback;
        return vi.fn();
      },
    },
    window: {
      showContact: vi.fn(),
      openWindow: vi.fn(),
      openExternalUrl: openExternalUrlMock,
    },
  }),
}));

vi.mock('../../../../shared/platform', () => ({
  isElectron: () => electronPlatform,
}));

vi.mock('../../../components/common', () => ({
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  ToggleSwitch: (props: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <button data-toggle="automatic-updates" data-checked={String(props.checked)} onClick={() => props.onChange?.(!props.checked)} />
  ),
  ProgressBar: (props: { value: number; 'aria-label'?: string }) => (
    <div role="progressbar" aria-valuenow={props.value} aria-label={props['aria-label']} />
  ),
}));

vi.mock('@renderer/components/common/Misc/AppLogo', () => ({ default: () => <span /> }));

describe('AboutTab updates', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    initialState = {
      status: 'idle',
      currentVersion: '2.6.7',
      canAutoUpdate: true,
      supportReason: null,
      updatedAt: 1,
    };
    updateListener = undefined;
    electronPlatform = true;
    getUpdateStateMock.mockReset().mockImplementation(() => Promise.resolve(initialState));
    checkForUpdatesMock.mockReset().mockResolvedValue(initialState);
    downloadUpdateMock.mockReset();
    installUpdateMock.mockReset();
    openExternalUrlMock.mockReset().mockResolvedValue(true);
    settings.automaticallyDownloadUpdates = true;
    updateSettingMock.mockReset().mockImplementation((key: string, value: boolean) => {
      if (key === 'automaticallyDownloadUpdates') settings.automaticallyDownloadUpdates = value;
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('shows fork attribution and manual-update information without updater controls', async () => {
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.About.SoraAttribution');
    expect(container.textContent).toContain('mlearn.About.SoraUpdates');
    expect(container.textContent).not.toContain('mlearn.About.Updates.Title');
    expect(getUpdateStateMock).not.toHaveBeenCalled();
    expect(updateListener).toBeUndefined();
    dispose();
  });

  it('keeps the upstream credit link accessible', async () => {
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.About.SoraUpstream')?.click();
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://github.com/adrianvla/mLearn');
    dispose();
  });
});
