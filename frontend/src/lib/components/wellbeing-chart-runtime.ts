import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
use([BarChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
export { init };
