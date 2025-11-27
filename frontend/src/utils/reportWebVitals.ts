import { onCLS, onFCP, onLCP, onTTFB, onINP } from 'web-vitals';
import { logger } from './logger';

const reportWebVitals = (onPerfEntry?: (metric: any) => void) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    onCLS(onPerfEntry);
    onFCP(onPerfEntry);
    onLCP(onPerfEntry);
    onTTFB(onPerfEntry);
    onINP(onPerfEntry);
  } else {
    // Default: log to console/logger
    onCLS((metric) => logger.debug('Web Vitals:', metric));
    onFCP((metric) => logger.debug('Web Vitals:', metric));
    onLCP((metric) => logger.debug('Web Vitals:', metric));
    onTTFB((metric) => logger.debug('Web Vitals:', metric));
    onINP((metric) => logger.debug('Web Vitals:', metric));
  }
};

export default reportWebVitals;
