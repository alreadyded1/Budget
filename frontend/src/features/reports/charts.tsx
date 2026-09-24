import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatCents } from '../../lib/money'
import { compactCents, SERIES } from './chartFormat'

const AXIS = { stroke: 'var(--chart-axis)', fontSize: 12 }

const tooltipProps = {
  formatter: (value: unknown) => formatCents(Number(value)),
  contentStyle: { fontSize: 12, borderRadius: 6 },
  cursor: { fill: 'var(--chart-grid)', opacity: 0.4 },
}

type BarRow = { label: string; value: number }

/** One measure across named things (spending by category or payee). */
export function HorizontalBars({ rows, name }: { rows: BarRow[]; name: string }) {
  const height = Math.max(120, rows.length * 28 + 30)
  return (
    <div className="h-full w-full" style={{ height }} role="img" aria-label={`${name} chart`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" tickFormatter={compactCents} {...AXIS} />
          <YAxis type="category" dataKey="label" width={140} {...AXIS} />
          <Tooltip {...tooltipProps} />
          <Bar dataKey="value" name={name} fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

type Series = { key: string; name: string; slot: number }

/** Two or more measures side by side per bucket (planned vs actual, income vs spending). */
export function GroupedBars({
  rows,
  series,
  name,
}: {
  rows: Record<string, string | number>[]
  series: Series[]
  name: string
}) {
  return (
    <div className="h-72 w-full" role="img" aria-label={`${name} chart`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 8, right: 8, top: 8, bottom: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis tickFormatter={compactCents} width={56} {...AXIS} />
          <Tooltip {...tooltipProps} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.name}
              fill={SERIES[item.slot]}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Change over time for a few chosen things (category trend). */
export function Lines({
  rows,
  series,
  name,
}: {
  rows: Record<string, string | number>[]
  series: Series[]
  name: string
}) {
  return (
    <div className="h-72 w-full" role="img" aria-label={`${name} chart`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis tickFormatter={compactCents} width={56} {...AXIS} />
          <Tooltip {...tooltipProps} cursor={{ stroke: 'var(--chart-axis)' }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((item) => (
            <Line
              key={item.key}
              dataKey={item.key}
              name={item.name}
              stroke={SERIES[item.slot]}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
