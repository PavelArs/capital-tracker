import React from 'react';
import './Skeleton.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  animation?: 'pulse' | 'wave' | 'none';
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  borderRadius,
  className = '',
  variant = 'rectangular',
  animation = 'pulse',
  style: customStyle,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'text':
        return { height: '1em', borderRadius: '4px' };
      case 'circular':
        return { borderRadius: '50%' };
      case 'rounded':
        return { borderRadius: '8px' };
      case 'rectangular':
      default:
        return { borderRadius: '4px' };
    }
  };

  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...getVariantStyles(),
    ...(borderRadius && {
      borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
    }),
    ...customStyle,
  };

  return <div className={`skeleton skeleton-${animation} ${className}`} style={style} />;
};

export default Skeleton;
