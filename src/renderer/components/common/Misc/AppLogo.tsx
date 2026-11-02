import logoUrl from '@/html/assets/icons/sora.svg';
import './AppLogo.css';

interface AppLogoProps {
  size?: string;
}

const AppLogo = (props: AppLogoProps) => {
  const size = () => props.size || '1em';
  return <img src={logoUrl} alt="Sora 空" class="app-logo" style={{ width: size(), height: size() }} />;
};

export default AppLogo;
