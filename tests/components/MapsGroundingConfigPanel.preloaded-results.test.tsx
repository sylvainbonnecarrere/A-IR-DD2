import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapsGroundingConfigPanel } from '../../components/panels/MapsGroundingConfigPanel';
import type { MapsPanelPreloadedResults } from '../../types';

const mockAddNodeMessage = jest.fn();

jest.mock('../../stores/useRuntimeStore', () => ({
  useRuntimeStore: () => ({
    addNodeMessage: mockAddNodeMessage,
    localLLMProfiles: [],
  }),
}));

jest.mock('../../services/llmService', () => ({
  generateContentWithMaps: jest.fn(),
}));

jest.mock('../../services/runtimeConfigResolver', () => ({
  resolveAgentRuntimeConfig: jest.fn(() => ({
    config: null,
    credential: null,
  })),
}));

jest.mock('../../components/panels/usePanelNodeContext', () => ({
  usePanelNodeContext: jest.fn(() => ({
    normalizedNodeId: 'node-instance-1',
    resolvedAgent: null,
  })),
}));

class MockLeafletMap {
  public layers: MockLeafletMarker[] = [];
  public setView = jest.fn(() => this);
  public fitBounds = jest.fn();
  public remove = jest.fn();

  public eachLayer(callback: (layer: MockLeafletMarker) => void) {
    this.layers.forEach((layer) => callback(layer));
  }
}

class MockLeafletMarker {
  public bindPopup = jest.fn();
  public openPopup = jest.fn();

  constructor(private readonly coordinates: [number, number]) {}

  public addTo(map: MockLeafletMap) {
    map.layers.push(this);
    return this;
  }

  public getLatLng() {
    return {
      lat: this.coordinates[0],
      lng: this.coordinates[1],
    };
  }
}

describe('MapsGroundingConfigPanel preloaded results', () => {
  let createdMap: MockLeafletMap | null;
  let originalLeaflet: unknown;

  beforeEach(() => {
    createdMap = null;
    originalLeaflet = (window as Window & { L?: unknown }).L;

    (window as Window & { L?: unknown }).L = {
      map: jest.fn(() => {
        createdMap = new MockLeafletMap();
        return createdMap;
      }),
      tileLayer: jest.fn(() => ({
        addTo: jest.fn(),
      })),
      marker: jest.fn((coordinates: [number, number]) => new MockLeafletMarker(coordinates)),
      latLngBounds: jest.fn(() => ({ north: 0, south: 0, east: 0, west: 0 })),
      Marker: MockLeafletMarker,
    };
  });

  afterEach(() => {
    (window as Window & { L?: unknown }).L = originalLeaflet as undefined;
  });

  it('renders preloaded places and recenters the mocked map when a result is clicked', async () => {
    const preloadedResults: MapsPanelPreloadedResults = {
      text: 'Voici une suggestion',
      query: 'Cafe Paris',
      mapSources: [
        {
          placeId: 'place-1',
          placeTitle: 'Cafe de Paris',
          uri: 'https://maps.google.com/?q=Cafe+de+Paris',
          coordinates: {
            latitude: 48.8566,
            longitude: 2.3522,
          },
          reviewExcerpts: ['Excellent cafe'],
        },
      ],
    };

    render(
      <MapsGroundingConfigPanel
        isOpen
        nodeId="node-instance-1"
        llmConfigs={[]}
        onClose={jest.fn()}
        preloadedResults={preloadedResults}
        hideSlideOver
      />,
    );

    await waitFor(() => expect(createdMap).not.toBeNull());
    expect(screen.getByText('Cafe de Paris')).toBeInTheDocument();
    expect(screen.getByText(/Lieux trouvés \(1\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cafe de Paris'));

    expect(createdMap?.setView).toHaveBeenLastCalledWith([48.8566, 2.3522], 15);
  });
});